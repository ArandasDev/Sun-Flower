import type {
  BulkDeleteResult,
  GuildActionResult,
  GuildActions,
} from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { Capability, ModuleManifest } from '../../shared/contracts/module.ts';

const MAX_REASON_LENGTH = 512;
const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 2_419_200_000;
const MAX_DELETE_MESSAGE_SECONDS = 604_800;

const FAILED: GuildActionResult = { ok: false, error: 'failed' };
const FORBIDDEN: GuildActionResult = { ok: false, error: 'forbidden' };
const BULK_FAILED: BulkDeleteResult = { ok: false, error: 'failed', deleted: 0 };
const MAX_BULK_DELETE = 100;
const MESSAGE_ID = /^\d{17,20}$/;

export class CapabilityError extends Error {
  constructor(moduleId: string, capability: Capability) {
    super(`Module "${moduleId}" does not declare the capability "${capability}"`);
    this.name = 'CapabilityError';
  }
}

export const UNAVAILABLE_GUILD: GuildActions = {
  deleteMessage: () => Promise.resolve(FAILED),
  timeout: () => Promise.resolve(FAILED),
  removeTimeout: () => Promise.resolve(FAILED),
  kick: () => Promise.resolve(FAILED),
  ban: () => Promise.resolve(FAILED),
  unban: () => Promise.resolve(FAILED),
  sendMessage: () => Promise.resolve(FAILED),
  sendDirectMessage: () => Promise.resolve(FAILED),
  bulkDeleteMessages: () => Promise.resolve(BULK_FAILED),
  getMemberRoleIds: () => Promise.resolve(undefined),
};

export interface ModuleGuildOptions {
  readonly manifest: ModuleManifest;
  readonly port: GuildActions;
  isDeveloper(userId: string): boolean;
  /** False once the module is FAILED or STOPPED: every action is then refused. */
  isActive(): boolean;
  readonly logger: Logger;
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function createModuleGuild(options: ModuleGuildOptions): GuildActions {
  const { manifest, port, logger } = options;
  const isDeveloper = (userId: string): boolean => options.isDeveloper(userId);
  const moduleId = manifest.id;
  const capabilities = new Set<Capability>(manifest.capabilities);

  /** Returns true, and warns, when the module may no longer act. */
  function refusedAsInactive(action: string): boolean {
    if (options.isActive()) return false;
    logger.warn({ module: moduleId, action }, 'guild action refused: module is not active');
    return true;
  }

  function requireCapability(capability: Capability, action: string): void {
    if (capabilities.has(capability)) return;
    logger.warn({ module: moduleId, action }, 'guild action refused: missing capability');
    throw new CapabilityError(moduleId, capability);
  }

  async function execute(
    action: string,
    reason: string | undefined,
    run: () => Promise<GuildActionResult>,
  ): Promise<GuildActionResult> {
    let result: GuildActionResult;
    try {
      result = await run();
    } catch {
      logger.error({ module: moduleId, action }, 'guild action failed unexpectedly');
      return FAILED;
    }
    logger.info(
      {
        module: moduleId,
        action,
        // Free text never reaches the log, only whether there was a reason.
        hasReason: reason !== undefined && reason !== '',
        result: result.ok ? 'ok' : result.error,
      },
      'guild action executed',
    );
    return result;
  }

  const clip = (reason: string): string => reason.slice(0, MAX_REASON_LENGTH);

  return {
    async deleteMessage(channelId, messageId) {
      if (refusedAsInactive('deleteMessage')) return FAILED;
      requireCapability('guild.moderate', 'deleteMessage');
      return await execute('deleteMessage', undefined, () =>
        port.deleteMessage(channelId, messageId),
      );
    },
    async timeout(userId, durationMs, reason) {
      if (refusedAsInactive('timeout')) return FAILED;
      requireCapability('guild.moderate', 'timeout');
      if (isDeveloper(userId)) return FORBIDDEN;
      if (!isIntegerInRange(durationMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)) {
        return FAILED;
      }
      const clipped = clip(reason);
      return await execute('timeout', clipped, () => port.timeout(userId, durationMs, clipped));
    },
    async removeTimeout(userId) {
      if (refusedAsInactive('removeTimeout')) return FAILED;
      requireCapability('guild.moderate', 'removeTimeout');
      return await execute('removeTimeout', undefined, () => port.removeTimeout(userId));
    },
    async kick(userId, reason) {
      if (refusedAsInactive('kick')) return FAILED;
      requireCapability('guild.moderate', 'kick');
      if (isDeveloper(userId)) return FORBIDDEN;
      const clipped = clip(reason);
      return await execute('kick', clipped, () => port.kick(userId, clipped));
    },
    async ban(userId, reason, deleteMessageSeconds) {
      if (refusedAsInactive('ban')) return FAILED;
      requireCapability('guild.moderate', 'ban');
      if (isDeveloper(userId)) return FORBIDDEN;
      if (!isIntegerInRange(deleteMessageSeconds, 0, MAX_DELETE_MESSAGE_SECONDS)) {
        return FAILED;
      }
      const clipped = clip(reason);
      return await execute('ban', clipped, () => port.ban(userId, clipped, deleteMessageSeconds));
    },
    async unban(userId) {
      if (refusedAsInactive('unban')) return FAILED;
      requireCapability('guild.moderate', 'unban');
      return await execute('unban', undefined, () => port.unban(userId));
    },
    async sendMessage(channelId, content) {
      if (refusedAsInactive('sendMessage')) return FAILED;
      requireCapability('guild.message', 'sendMessage');
      return await execute('sendMessage', undefined, () => port.sendMessage(channelId, content));
    },
    async sendDirectMessage(userId, content) {
      if (refusedAsInactive('sendDirectMessage')) return FAILED;
      requireCapability('guild.moderate', 'sendDirectMessage');
      return await execute('sendDirectMessage', undefined, () =>
        port.sendDirectMessage(userId, content),
      );
    },
    async bulkDeleteMessages(channelId, messageIds) {
      if (refusedAsInactive('bulkDeleteMessages')) return BULK_FAILED;
      requireCapability('guild.moderate', 'bulkDeleteMessages');
      const unique = [...new Set(messageIds)];
      if (
        unique.length < 1 ||
        unique.length > MAX_BULK_DELETE ||
        !unique.every((id) => MESSAGE_ID.test(id))
      ) {
        return BULK_FAILED;
      }
      let result: BulkDeleteResult;
      try {
        result = await port.bulkDeleteMessages(channelId, unique);
      } catch {
        logger.error(
          { module: moduleId, action: 'bulkDeleteMessages' },
          'guild action failed unexpectedly',
        );
        return BULK_FAILED;
      }
      logger.info(
        {
          module: moduleId,
          action: 'bulkDeleteMessages',
          requested: unique.length,
          deleted: result.deleted,
          individually: result.ok ? result.individually : 0,
          result: result.ok ? 'ok' : result.error,
        },
        'guild action executed',
      );
      return result;
    },
    async getMemberRoleIds(userId) {
      if (refusedAsInactive('getMemberRoleIds')) return undefined;
      requireCapability('guild.moderate', 'getMemberRoleIds');
      try {
        return await port.getMemberRoleIds(userId);
      } catch {
        logger.error(
          { module: moduleId, action: 'getMemberRoleIds' },
          'guild action failed unexpectedly',
        );
        return undefined;
      }
    },
  };
}
