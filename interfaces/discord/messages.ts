import {
  DISCORD_MESSAGE_CREATED,
  DISCORD_MESSAGE_UPDATED,
  type DiscordMessagePayload,
} from '../../shared/contracts/discord-events.ts';
import type { Logger } from '../../shared/contracts/logger.ts';

/** Transport-neutral view of a Discord message, so the logic here never touches discord.js. */
export interface RawMessage {
  readonly guildId: string | null;
  readonly messageId: string;
  readonly messageUrl: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly authorIsBot: boolean;
  readonly isWebhook: boolean;
  /** Join notices, pins, boosts and other messages Discord generates itself. */
  readonly isSystem: boolean;
  readonly content: string;
  /** Attachments, embeds, stickers, polls or forwarded messages. */
  readonly hasNonTextParts: boolean;
  readonly authorRoleIds: readonly string[];
  readonly authorJoinedAt: string | null;
  readonly authorAccountCreatedAt: string;
}

export interface MessageEventContext {
  readonly userId: string;
  readonly channelId: string;
}

export interface MessageHandlerDeps {
  readonly guildId: string;
  readonly monitor: ContentIntentMonitor;
  readonly publish: (type: string, payload: unknown, context: MessageEventContext) => void;
}

const EMPTY_CONTENT_ERROR =
  'message content is empty: enable the Message Content Intent in the Discord Developer Portal';

/** Only humans in the configured guild are published; DMs, bots, webhooks and system messages are not. */
export function shouldPublish(raw: RawMessage, guildId: string): boolean {
  return raw.guildId === guildId && !raw.authorIsBot && !raw.isWebhook && !raw.isSystem;
}

export function toMessagePayload(raw: RawMessage): DiscordMessagePayload {
  return {
    messageId: raw.messageId,
    messageUrl: raw.messageUrl,
    channelId: raw.channelId,
    authorId: raw.authorId,
    authorRoleIds: raw.authorRoleIds,
    authorJoinedAt: raw.authorJoinedAt,
    authorAccountCreatedAt: raw.authorAccountCreatedAt,
    content: raw.content,
  };
}

/** An unknown previous content (null) counts as a change. */
export function isContentChange(oldContent: string | null, newContent: string): boolean {
  return oldContent === null || oldContent !== newContent;
}

/**
 * Without the Message Content Intent Discord delivers empty content. Watches the first human
 * messages that could carry text and reports once if every one of them is empty.
 */
export class ContentIntentMonitor {
  readonly #logger: Logger;
  readonly #sampleSize: number;
  #seen = 0;
  #done = false;

  constructor(logger: Logger, sampleSize = 20) {
    this.#logger = logger;
    this.#sampleSize = sampleSize;
  }

  observe(raw: RawMessage): void {
    if (this.#done || raw.hasNonTextParts || raw.isSystem) return;
    if (raw.content !== '') {
      this.#done = true;
      return;
    }
    this.#seen += 1;
    if (this.#seen >= this.#sampleSize) {
      this.#done = true;
      this.#logger.error(EMPTY_CONTENT_ERROR);
    }
  }
}

export function handleMessageCreate(raw: RawMessage, deps: MessageHandlerDeps): void {
  if (!shouldPublish(raw, deps.guildId)) return;
  deps.monitor.observe(raw);
  deps.publish(DISCORD_MESSAGE_CREATED, toMessagePayload(raw), {
    userId: raw.authorId,
    channelId: raw.channelId,
  });
}

export function handleMessageUpdate(
  oldContent: string | null,
  raw: RawMessage,
  deps: MessageHandlerDeps,
): void {
  if (!shouldPublish(raw, deps.guildId)) return;
  if (!isContentChange(oldContent, raw.content)) return;
  deps.publish(DISCORD_MESSAGE_UPDATED, toMessagePayload(raw), {
    userId: raw.authorId,
    channelId: raw.channelId,
  });
}

/** Runs a handler; a thrown error is logged with its message only, never content or IDs. */
export function guardHandler(logger: Logger, handler: () => void): void {
  try {
    handler();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'discord message event failed',
    );
  }
}
