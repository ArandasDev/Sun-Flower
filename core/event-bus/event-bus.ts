import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { EventContext, EventHandler, SunFlowerEvent } from '../../shared/contracts/events.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { ModuleContext, ModuleManifest } from '../../shared/contracts/module.ts';
import { withTimeout } from '../infrastructure/timeout.ts';

const DEFAULT_HANDLER_TIMEOUT_MS = 5000;
const DEFAULT_MAX_DEPTH = 8;

export class UndeclaredEventError extends Error {
  constructor(moduleId: string, type: string) {
    super(`Module "${moduleId}" is not allowed to use undeclared event "${type}"`);
    this.name = 'UndeclaredEventError';
  }
}

export interface EventBusOptions {
  readonly handlerTimeoutMs?: number;
  readonly maxDepth?: number;
}

export type ModuleEvents = ModuleContext['events'] & { unsubscribeAll(): void };

interface Subscription {
  readonly moduleId: string;
  readonly handler: EventHandler;
  active: boolean;
}

interface DepthStore {
  readonly depth: number;
}

export class EventBus {
  private readonly logger: Logger;
  private readonly handlerTimeoutMs: number;
  private readonly maxDepth: number;
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly depthStorage = new AsyncLocalStorage<DepthStore>();

  constructor(logger: Logger, options: EventBusOptions = {}) {
    this.logger = logger;
    this.handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  forModule(manifest: ModuleManifest): ModuleEvents {
    const owned = new Set<Subscription>();
    return {
      publish: (type, payload, context) => {
        this.publishFrom(manifest, type, payload, context);
      },
      subscribe: (type, handler) => {
        if (!manifest.events.subscribes.includes(type)) {
          throw new UndeclaredEventError(manifest.id, type);
        }
        const subscription: Subscription = { moduleId: manifest.id, handler, active: true };
        owned.add(subscription);
        let set = this.subscriptions.get(type);
        if (set === undefined) {
          set = new Set();
          this.subscriptions.set(type, set);
        }
        set.add(subscription);
      },
      unsubscribeAll: () => {
        for (const subscription of owned) {
          subscription.active = false;
          for (const set of this.subscriptions.values()) {
            set.delete(subscription);
          }
        }
        owned.clear();
      },
    };
  }

  /** Resolves once every scheduled handler has settled, including ones scheduled meanwhile. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private publishFrom(
    manifest: ModuleManifest,
    type: string,
    payload: unknown,
    context: EventContext | undefined,
  ): void {
    if (!manifest.events.publishes.includes(type) || !type.startsWith(`${manifest.id}.`)) {
      throw new UndeclaredEventError(manifest.id, type);
    }
    const depth = this.depthStorage.getStore()?.depth ?? 0;
    if (depth >= this.maxDepth) {
      this.logger.warn(
        { module: manifest.id, type, depth, maxDepth: this.maxDepth },
        'event dropped: maximum depth exceeded',
      );
      return;
    }
    const event: SunFlowerEvent = {
      id: randomUUID(),
      type,
      version: 1,
      source: manifest.id,
      timestamp: new Date().toISOString(),
      context: context ?? {},
      payload,
    };
    for (const subscription of [...(this.subscriptions.get(type) ?? [])]) {
      this.schedule(subscription, event, depth + 1);
    }
  }

  private schedule(subscription: Subscription, event: SunFlowerEvent, depth: number): void {
    const task: Promise<void> = new Promise<void>((resolve) => {
      setImmediate(() => {
        void this.depthStorage
          .run({ depth }, () => this.deliver(subscription, event))
          .then(resolve);
      });
    }).finally(() => {
      this.pending.delete(task);
    });
    this.pending.add(task);
  }

  private async deliver(subscription: Subscription, event: SunFlowerEvent): Promise<void> {
    if (!subscription.active) {
      return;
    }
    try {
      await withTimeout(
        async () => {
          await subscription.handler(event);
        },
        this.handlerTimeoutMs,
        `event handler ${subscription.moduleId} for ${event.type}`,
      );
    } catch (error) {
      this.logger.error(
        {
          module: subscription.moduleId,
          event: event.type,
          error: error instanceof Error ? error.message : String(error),
        },
        'event handler failed',
      );
    }
  }
}
