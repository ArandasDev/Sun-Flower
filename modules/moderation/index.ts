import {
  DISCORD_MESSAGE_CREATED,
  DISCORD_MESSAGE_UPDATED,
} from '../../shared/contracts/discord-events.ts';
import type { DiscordMessagePayload } from '../../shared/contracts/discord-events.ts';
import type { SunFlowerEvent } from '../../shared/contracts/events.ts';
import type { ModuleContext, ModuleFactory } from '../../shared/contracts/module.ts';
import { CaseStore } from './cases.ts';
import { buildModCommand } from './commands/mod-command.ts';
import type { ModerationConfig } from './config.ts';
import { MultiChannelTracker } from './detection/multi-channel.ts';
import { DomainStore } from './domains.ts';
import { registerModerationOperations } from './operations/index.ts';
import { Responder } from './responder.ts';
import { ActivityLog } from './spam/activity.ts';
import { SpamCooldown } from './spam/rules.ts';

export { configSchema } from './config.ts';

const PRUNE_INTERVAL_MS = 60_000;
const MAX_ACTIVITY_AGE_MS = 3_600_000;

/** The longest window any spam rule looks back (detection or deletion), capped at one hour. */
export function activityMaxAgeMs(spam: ModerationConfig['spam']): number {
  const windows = [
    spam.flood.seconds * 1000,
    spam.flood.deleteMinutes * 60_000,
    spam.repeat.seconds * 1000,
    spam.repeat.deleteMinutes * 60_000,
    spam.mentions.deleteMinutes * 60_000,
  ];
  return Math.min(MAX_ACTIVITY_AGE_MS, Math.max(...windows));
}

const createModeration: ModuleFactory = () => {
  let context: ModuleContext | undefined;
  let responder: Responder | undefined;
  let tracker: MultiChannelTracker | undefined;
  let activity: ActivityLog | undefined;
  let cooldown: SpamCooldown | undefined;
  let caseStore: CaseStore | undefined;
  let domainStore: DomainStore | undefined;
  let pruneTimer: ReturnType<typeof setInterval> | undefined;

  const onCreated = async (event: SunFlowerEvent): Promise<void> => {
    await responder?.handle(event.payload as DiscordMessagePayload, 'created');
  };
  const onUpdated = async (event: SunFlowerEvent): Promise<void> => {
    await responder?.handle(event.payload as DiscordMessagePayload, 'updated');
  };

  const required = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('moderation is not initialized');
    return value;
  };

  const clearPruneTimer = (): void => {
    if (pruneTimer !== undefined) clearInterval(pruneTimer);
    pruneTimer = undefined;
  };

  return {
    register: async (ctx) => {
      await Promise.resolve();
      context = ctx;
      ctx.events.subscribe(DISCORD_MESSAGE_CREATED, onCreated);
      ctx.events.subscribe(DISCORD_MESSAGE_UPDATED, onUpdated);
      registerModerationOperations(ctx, { domains: () => required(domainStore) });
      ctx.commands.register(
        buildModCommand({
          permissions: ctx.permissions,
          config: ctx.config,
          operations: ctx.operations,
          guild: ctx.guild,
          get cases() {
            return required(caseStore);
          },
          get domains() {
            return required(domainStore);
          },
          publish: (type, payload) => {
            ctx.events.publish(type, payload);
          },
        }),
      );
    },
    initialize: async () => {
      await Promise.resolve();
      if (context === undefined) throw new Error('moderation was not registered');
      const ctx = context;
      const lists = new DomainStore(ctx.storage);
      lists.seedOfficial(new Date().toISOString());
      domainStore = lists;
      const cases = new CaseStore(ctx.storage);
      caseStore = cases;
      tracker = new MultiChannelTracker({ maxAuthors: 1000, maxEntries: 50 });
      activity = new ActivityLog({ maxAuthors: 2000, maxEntries: 200 });
      cooldown = new SpamCooldown();
      responder = new Responder({
        guild: ctx.guild,
        cases,
        lists,
        tracker,
        activity,
        cooldown,
        config: () => ctx.config.get<ModerationConfig>(),
        isDeveloper: (userId) => ctx.permissions.isDeveloper(userId),
        publish: (type, payload) => {
          ctx.events.publish(type, payload);
        },
        logger: ctx.logger,
      });
    },
    start: async () => {
      await Promise.resolve();
      clearPruneTimer();
      pruneTimer = setInterval(() => {
        if (context === undefined || tracker === undefined) return;
        try {
          const config = context.config.get<ModerationConfig>();
          const now = Date.now();
          tracker.prune(now, config.multiChannel.windowSeconds * 1000);
          activity?.prune(now, activityMaxAgeMs(config.spam));
          cooldown?.prune(now);
        } catch (error) {
          context.logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'moderation prune failed',
          );
        }
      }, PRUNE_INTERVAL_MS);
      pruneTimer.unref();
    },
    stop: async () => {
      await Promise.resolve();
      clearPruneTimer();
    },
    dispose: async () => {
      await Promise.resolve();
      clearPruneTimer();
      responder = undefined;
      tracker = undefined;
      activity = undefined;
      cooldown = undefined;
      caseStore = undefined;
      domainStore = undefined;
    },
  };
};

export default createModeration;
