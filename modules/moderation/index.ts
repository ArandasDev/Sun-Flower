import {
  DISCORD_MESSAGE_CREATED,
  DISCORD_MESSAGE_UPDATED,
} from '../../shared/contracts/discord-events.ts';
import type { DiscordMessagePayload } from '../../shared/contracts/discord-events.ts';
import type { SunFlowerEvent } from '../../shared/contracts/events.ts';
import type { ModuleContext, ModuleFactory } from '../../shared/contracts/module.ts';
import { CaseStore } from './cases.ts';
import type { ModerationConfig } from './config.ts';
import { MultiChannelTracker } from './detection/multi-channel.ts';
import { DomainStore } from './domains.ts';
import { Responder } from './responder.ts';

export { configSchema } from './config.ts';

const PRUNE_INTERVAL_MS = 60_000;

const createModeration: ModuleFactory = () => {
  let context: ModuleContext | undefined;
  let responder: Responder | undefined;
  let tracker: MultiChannelTracker | undefined;
  let pruneTimer: ReturnType<typeof setInterval> | undefined;

  const onMessage = async (event: SunFlowerEvent): Promise<void> => {
    await responder?.handle(event.payload as DiscordMessagePayload);
  };

  const clearPruneTimer = (): void => {
    if (pruneTimer !== undefined) clearInterval(pruneTimer);
    pruneTimer = undefined;
  };

  return {
    register: async (ctx) => {
      await Promise.resolve();
      context = ctx;
      ctx.events.subscribe(DISCORD_MESSAGE_CREATED, onMessage);
      ctx.events.subscribe(DISCORD_MESSAGE_UPDATED, onMessage);
    },
    initialize: async () => {
      await Promise.resolve();
      if (context === undefined) throw new Error('moderation was not registered');
      const ctx = context;
      const lists = new DomainStore(ctx.storage);
      lists.seedOfficial(new Date().toISOString());
      tracker = new MultiChannelTracker({ maxAuthors: 1000, maxEntries: 50 });
      responder = new Responder({
        guild: ctx.guild,
        cases: new CaseStore(ctx.storage),
        lists,
        tracker,
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
          tracker.prune(Date.now(), config.multiChannel.windowSeconds * 1000);
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
    },
  };
};

export default createModeration;
