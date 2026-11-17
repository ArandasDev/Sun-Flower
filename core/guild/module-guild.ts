import type { GuildActionResult, GuildActions } from '../../shared/contracts/guild.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import type { Capability, ModuleManifest } from '../../shared/contracts/module.ts';

const MAX_REASON_LENGTH = 512;
const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 2_419_200_000;
const MAX_DELETE_MESSAGE_SECONDS = 604_800;

const FAILED: GuildActionResult = { ok: false, error: 'failed' };
const FORBIDDEN: GuildActionResult = { ok: false, error: 'forbidden' };

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
  getMemberRoleIds: () => Promise.resolve(undefined),
};

export interface ModuleGuildOptions {
  readonly manifest: ModuleManifest;
  readonly port: GuildActions;
  isDeveloper(userId: string): boolean;
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
        ...(reason === undefined ? {} : { reason }),
        result: result.ok ? 'ok' : result.error,
      },
      'guild action executed',
    );
    return result;
  }

  const clip = (reason: string): string => reason.slice(0, MAX_REASON_LENGTH);

  return {
    async deleteMessage(channelId, messageId) {
      requireCapability('guild.moderate', 'deleteMessage');
      return await execute('deleteMessage', undefined, () =>
        port.deleteMessage(channelId, messageId),
      );
    },
    async timeout(userId, durationMs, reason) {
      requireCapability('guild.moderate', 'timeout');
      if (isDeveloper(userId)) return FORBIDDEN;
      if (!isIntegerInRange(durationMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)) {
        return FAILED;
      }
      const clipped = clip(reason);
      return await execute('timeout', clipped, () => port.timeout(userId, durationMs, clipped));
    },
    async removeTimeout(userId) {
      requireCapability('guild.moderate', 'removeTimeout');
      return await execute('removeTimeout', undefined, () => port.removeTimeout(userId));
    },
    async kick(userId, reason) {
      requireCapability('guild.moderate', 'kick');
      if (isDeveloper(userId)) return FORBIDDEN;
      const clipped = clip(reason);
      return await execute('kick', clipped, () => port.kick(userId, clipped));
    },
    async ban(userId, reason, deleteMessageSeconds) {
      requireCapability('guild.moderate', 'ban');
      if (isDeveloper(userId)) return FORBIDDEN;
      if (!isIntegerInRange(deleteMessageSeconds, 0, MAX_DELETE_MESSAGE_SECONDS)) {
        return FAILED;
      }
      const clipped = clip(reason);
      return await execute('ban', clipped, () => port.ban(userId, clipped, deleteMessageSeconds));
    },
    async unban(userId) {
      requireCapability('guild.moderate', 'unban');
      return await execute('unban', undefined, () => port.unban(userId));
    },
    async sendMessage(channelId, content) {
      requireCapability('guild.message', 'sendMessage');
      return await execute('sendMessage', undefined, () => port.sendMessage(channelId, content));
    },
    async sendDirectMessage(userId, content) {
      requireCapability('guild.moderate', 'sendDirectMessage');
      return await execute('sendDirectMessage', undefined, () =>
        port.sendDirectMessage(userId, content),
      );
    },
    async getMemberRoleIds(userId) {
      requireCapability('guild.moderate', 'getMemberRoleIds');
      return await port.getMemberRoleIds(userId);
    },
  };
}
