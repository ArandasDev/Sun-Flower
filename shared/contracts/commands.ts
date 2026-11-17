export interface Actor {
  readonly userId: string;
  readonly roleIds: readonly string[];
}

export interface ReplyOptions {
  /**
   * Shows the reply only to the user who ran the command. A reply sent after the automatic
   * deferral (2.5 s) is delivered as an edit of the deferred, non-ephemeral response, so it
   * is visible to everyone regardless of this flag.
   */
  readonly ephemeral?: boolean;
}

export interface CommandInteraction {
  readonly actor: Actor;
  reply(content: string, options?: ReplyOptions): Promise<void>;
}

export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  handle(interaction: CommandInteraction): Promise<void>;
}
