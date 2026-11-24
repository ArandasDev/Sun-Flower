export interface Actor {
  readonly userId: string;
  readonly roleIds: readonly string[];
  /** Whether the actor is the current owner of the guild. */
  readonly isOwner: boolean;
}

export interface ReplyOptions {
  /**
   * Shows the reply only to the user who ran the command. The automatic deferral (2.5 s) is
   * always ephemeral, so a reply sent after it is delivered as an edit of that ephemeral
   * response and stays private regardless of this flag. A command that wants a public reply
   * must answer within 2.5 s.
   */
  readonly ephemeral?: boolean;
}

export type CommandOptionType = 'string' | 'integer' | 'boolean' | 'user' | 'channel' | 'role';

export interface CommandOption {
  readonly name: string;
  readonly description: string;
  readonly type: CommandOptionType;
  readonly required?: boolean;
  readonly minValue?: number; // integer
  readonly maxValue?: number; // integer
  readonly maxLength?: number; // string
  /** Only for 'string' options; each choice's name equals its value. */
  readonly choices?: readonly string[];
}

export interface Subcommand {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOption[];
}

export interface SubcommandGroup {
  readonly name: string;
  readonly description: string;
  readonly subcommands: readonly Subcommand[];
}

export interface CommandOptions {
  getString(name: string): string | undefined;
  getInteger(name: string): number | undefined;
  getBoolean(name: string): boolean | undefined;
  getUser(name: string): string | undefined; // user ID
  getChannel(name: string): string | undefined; // channel ID
  getRole(name: string): string | undefined; // role ID
}

export interface CommandInteraction {
  readonly actor: Actor;
  readonly channelId: string;
  readonly subcommandGroup: string | undefined;
  readonly subcommand: string | undefined;
  readonly options: CommandOptions;
  reply(content: string, options?: ReplyOptions): Promise<void>;
}

export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOption[];
  readonly subcommands?: readonly Subcommand[];
  readonly groups?: readonly SubcommandGroup[];
  handle(interaction: CommandInteraction): Promise<void>;
}
