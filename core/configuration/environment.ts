import { z } from 'zod';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface Environment {
  readonly discordToken: string;
  readonly guildId: string;
  readonly dbPath: string;
  readonly logLevel: LogLevel;
}

export interface DatabaseEnvironment {
  readonly dbPath: string;
  readonly logLevel: LogLevel;
}

type Source = Record<string, string | undefined>;

const rules: Record<string, string> = {
  DISCORD_TOKEN: 'must not be empty',
  DISCORD_GUILD_ID: 'must have 17 to 20 digits',
  LOG_LEVEL: 'must be one of fatal, error, warn, info, debug, trace',
};

export class EnvironmentError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(
      `Invalid environment: ${variables
        .map((name) => `${name} ${rules[name] ?? 'is invalid'}`)
        .join('; ')}`,
    );
    this.name = 'EnvironmentError';
    this.variables = variables;
  }
}

function present(source: Source, name: string): string | undefined {
  const value = source[name];
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

const databaseShape = {
  SUNFLOWER_DB_PATH: z.string().default('data/sun-flower.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
};

const databaseSchema = z.object(databaseShape);
const environmentSchema = z.object({
  DISCORD_TOKEN: z.string(),
  DISCORD_GUILD_ID: z.string().regex(/^\d{17,20}$/),
  ...databaseShape,
});

function parse<T extends z.ZodType>(schema: T, source: Source, names: string[]): z.output<T> {
  const input: Record<string, string | undefined> = {};
  for (const name of names) input[name] = present(source, name);
  const result = schema.safeParse(input);
  if (!result.success) {
    const failed = new Set<string>();
    for (const issue of result.error.issues) {
      const name = issue.path[0];
      if (typeof name === 'string') failed.add(name);
    }
    throw new EnvironmentError([...failed]);
  }
  return result.data;
}

export function loadDatabaseEnvironment(env: Source): DatabaseEnvironment {
  const parsed = parse(databaseSchema, env, ['SUNFLOWER_DB_PATH', 'LOG_LEVEL']);
  return { dbPath: parsed.SUNFLOWER_DB_PATH, logLevel: parsed.LOG_LEVEL };
}

export function loadEnvironment(env: Source): Environment {
  const parsed = parse(environmentSchema, env, [
    'DISCORD_TOKEN',
    'DISCORD_GUILD_ID',
    'SUNFLOWER_DB_PATH',
    'LOG_LEVEL',
  ]);
  return {
    discordToken: parsed.DISCORD_TOKEN,
    guildId: parsed.DISCORD_GUILD_ID,
    dbPath: parsed.SUNFLOWER_DB_PATH,
    logLevel: parsed.LOG_LEVEL,
  };
}
