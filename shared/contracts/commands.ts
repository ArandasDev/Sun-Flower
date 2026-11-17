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
