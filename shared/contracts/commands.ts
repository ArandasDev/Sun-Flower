export interface Actor {
  readonly userId: string;
  readonly roleIds: readonly string[];
}

export interface ReplyOptions {
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
