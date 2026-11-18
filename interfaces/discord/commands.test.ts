import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandDefinition, CommandInteraction } from '../../shared/contracts/commands.ts';
import { ApplicationCommandOptionType } from 'discord.js';
import {
  dispatchCommand,
  syncCommands,
  toDiscordCommandData,
  type RawInteraction,
} from './commands.ts';
import { createRecordingLogger } from '../../tests/helpers/recording-logger.ts';

const userId = '000000000000000000';
const roleId = '111111111111111111';

type Call =
  | { readonly kind: 'reply'; readonly content: string; readonly ephemeral: boolean }
  | { readonly kind: 'deferReply'; readonly ephemeral: boolean }
  | { readonly kind: 'editReply'; readonly content: string };

interface FakeInteraction extends RawInteraction {
  readonly calls: Call[];
}

function fakeInteraction(
  commandName: string,
  failures: { reply?: boolean; editReply?: boolean } = {},
): FakeInteraction {
  const calls: Call[] = [];
  return {
    calls,
    commandName,
    userId,
    roleIds: [roleId],
    guildId: '000000000000000000',
    channelId: '222222222222222222',
    subcommandGroup: 'grp',
    subcommand: 'sub',
    options: {
      getString: (n) => (n === 'text' ? 'hello' : undefined),
      getInteger: () => undefined,
      getBoolean: () => undefined,
      getUser: () => undefined,
      getChannel: () => undefined,
      getRole: () => undefined,
    },
    reply: async (content, ephemeral) => {
      await Promise.resolve();
      calls.push({ kind: 'reply', content, ephemeral });
      if (failures.reply === true) {
        throw new Error('Discord API failure');
      }
    },
    deferReply: async (ephemeral) => {
      await Promise.resolve();
      calls.push({ kind: 'deferReply', ephemeral });
    },
    editReply: async (content) => {
      await Promise.resolve();
      calls.push({ kind: 'editReply', content });
      if (failures.editReply === true) {
        throw new Error('Discord API failure');
      }
    },
  };
}

function command(
  name: string,
  handle: (interaction: CommandInteraction) => Promise<void>,
): ReadonlyMap<string, CommandDefinition> {
  return new Map([[name, { name, description: `${name} command`, handle }]]);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('syncCommands', () => {
  function fakeTarget() {
    const calls: unknown[] = [];
    return {
      calls,
      setGuildCommands: async (commands: { name: string; description: string }[]) => {
        await Promise.resolve();
        calls.push({ guild: commands });
      },
      clearGlobalCommands: async () => {
        await Promise.resolve();
        calls.push('clearGlobal');
      },
    };
  }

  it('replaces guild commands and clears global ones', async () => {
    const target = fakeTarget();
    const handle = async (): Promise<void> => {};
    await syncCommands(target, [
      { name: 'zeta', description: 'Zeta', handle },
      { name: 'alpha', description: 'Alpha', handle },
    ]);

    expect(target.calls).toEqual([
      {
        guild: [
          { name: 'alpha', description: 'Alpha' },
          { name: 'zeta', description: 'Zeta' },
        ],
      },
      'clearGlobal',
    ]);
  });

  it('still replaces guild commands when the list is empty', async () => {
    const target = fakeTarget();
    await syncCommands(target, []);

    expect(target.calls).toEqual([{ guild: [] }, 'clearGlobal']);
  });
});

describe('dispatchCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the actor and replies', async () => {
    const logger = createRecordingLogger();
    const raw = fakeInteraction('ping');
    let seen: unknown;
    await dispatchCommand(
      raw,
      command('ping', async (interaction) => {
        seen = interaction.actor;
        await interaction.reply('Pong!');
      }),
      logger,
    );

    expect(seen).toEqual({ userId, roleIds: [roleId] });
    expect(raw.calls).toEqual([{ kind: 'reply', content: 'Pong!', ephemeral: false }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards the ephemeral option before deferral', async () => {
    const raw = fakeInteraction('ping');
    await dispatchCommand(
      raw,
      command('ping', async (interaction) => {
        await interaction.reply('secret', { ephemeral: true });
      }),
      createRecordingLogger(),
    );

    expect(raw.calls).toEqual([{ kind: 'reply', content: 'secret', ephemeral: true }]);
  });

  it('defers after the threshold and edits the reply', async () => {
    const raw = fakeInteraction('slow');
    const done = dispatchCommand(
      raw,
      command('slow', async (interaction) => {
        await sleep(30);
        await interaction.reply('Done', { ephemeral: true });
      }),
      createRecordingLogger(),
      { deferAfterMs: 10 },
    );
    await vi.advanceTimersByTimeAsync(30);
    await done;

    expect(raw.calls).toEqual([
      { kind: 'deferReply', ephemeral: true },
      { kind: 'editReply', content: 'Done' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defers after 2500 ms by default', async () => {
    const raw = fakeInteraction('slow');
    const done = dispatchCommand(
      raw,
      command('slow', async (interaction) => {
        await sleep(3000);
        await interaction.reply('Done');
      }),
      createRecordingLogger(),
    );
    await vi.advanceTimersByTimeAsync(2499);
    expect(raw.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(raw.calls).toEqual([{ kind: 'deferReply', ephemeral: true }]);
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(raw.calls).toEqual([
      { kind: 'deferReply', ephemeral: true },
      { kind: 'editReply', content: 'Done' },
    ]);
  });

  it('answers unknown commands with Comando indisponível.', async () => {
    const raw = fakeInteraction('missing');
    await dispatchCommand(
      raw,
      command('ping', async () => {}),
      createRecordingLogger(),
    );

    expect(raw.calls).toEqual([
      { kind: 'reply', content: 'Comando indisponível.', ephemeral: true },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a second reply from the handler', async () => {
    const logger = createRecordingLogger();
    const raw = fakeInteraction('ping');
    await dispatchCommand(
      raw,
      command('ping', async (interaction) => {
        await interaction.reply('first');
        await interaction.reply('second');
      }),
      logger,
    );

    expect(raw.calls).toEqual([{ kind: 'reply', content: 'first', ephemeral: false }]);
    expect(logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('hides handler errors from the user', async () => {
    const logger = createRecordingLogger();
    const raw = fakeInteraction('boom');
    await dispatchCommand(
      raw,
      command('boom', async () => {
        await Promise.resolve();
        throw new Error('db password=x');
      }),
      logger,
    );

    expect(raw.calls).toEqual([{ kind: 'reply', content: 'Ocorreu um erro.', ephemeral: true }]);
    expect(JSON.stringify(raw.calls)).not.toContain('password');
    const errors = logger.entries.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toMatchObject({ command: 'boom', error: 'db password=x' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('edits the deferred reply with the generic error after deferral', async () => {
    const raw = fakeInteraction('boom');
    const done = dispatchCommand(
      raw,
      command('boom', async () => {
        await sleep(30);
        throw new Error('db password=x');
      }),
      createRecordingLogger(),
      { deferAfterMs: 10 },
    );
    await vi.advanceTimersByTimeAsync(30);
    await done;

    expect(raw.calls).toEqual([
      { kind: 'deferReply', ephemeral: true },
      { kind: 'editReply', content: 'Ocorreu um erro.' },
    ]);
  });

  it('never logs user, guild or role IDs', async () => {
    const logger = createRecordingLogger();
    await dispatchCommand(
      fakeInteraction('boom'),
      command('boom', async (interaction) => {
        await interaction.reply('first');
        await interaction.reply('second');
        throw new Error('later failure');
      }),
      logger,
    );

    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toContain(userId);
    expect(logged).not.toContain(roleId);
  });

  it('does not send a second message when the handler throws after replying', async () => {
    const logger = createRecordingLogger();
    const raw = fakeInteraction('boom');
    await dispatchCommand(
      raw,
      command('boom', async (interaction) => {
        await interaction.reply('partial');
        throw new Error('late failure');
      }),
      logger,
    );

    expect(raw.calls).toEqual([{ kind: 'reply', content: 'partial', ephemeral: false }]);
    expect(logger.entries.filter((e) => e.level === 'error')).toHaveLength(1);
  });

  it('logs and swallows a failing reply', async () => {
    const logger = createRecordingLogger();
    const raw = fakeInteraction('ping', { reply: true });
    await expect(
      dispatchCommand(
        raw,
        command('ping', async (interaction) => {
          await interaction.reply('Pong!');
        }),
        logger,
      ),
    ).resolves.toBeUndefined();

    expect(logger.entries.some((e) => e.level === 'error')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs and swallows a failing error reply', async () => {
    const logger = createRecordingLogger();
    const raw = fakeInteraction('boom', { reply: true });
    await expect(
      dispatchCommand(
        raw,
        command('boom', async () => {
          await Promise.resolve();
          throw new Error('boom');
        }),
        logger,
      ),
    ).resolves.toBeUndefined();

    expect(logger.entries.filter((e) => e.level === 'error')).toHaveLength(2);
  });

  it('logs and swallows a failing editReply', async () => {
    const logger = createRecordingLogger();
    const raw = fakeInteraction('slow', { editReply: true });
    const done = dispatchCommand(
      raw,
      command('slow', async (interaction) => {
        await sleep(30);
        await interaction.reply('Done');
      }),
      logger,
      { deferAfterMs: 10 },
    );
    await vi.advanceTimersByTimeAsync(30);
    await expect(done).resolves.toBeUndefined();

    expect(logger.entries.some((e) => e.level === 'error')).toBe(true);
  });

  it('logs and swallows a failing unknown-command reply', async () => {
    const logger = createRecordingLogger();
    await expect(
      dispatchCommand(fakeInteraction('missing', { reply: true }), new Map(), logger),
    ).resolves.toBeUndefined();

    expect(logger.entries.some((e) => e.level === 'error')).toBe(true);
  });

  it('clears the timer when the handler completes without replying', async () => {
    const raw = fakeInteraction('quiet');
    await dispatchCommand(
      raw,
      command('quiet', async () => {}),
      createRecordingLogger(),
    );

    expect(raw.calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('toDiscordCommandData', () => {
  const handle = async (): Promise<void> => {
    await Promise.resolve();
  };

  it('serializes a plain command to exactly name and description', () => {
    const data = toDiscordCommandData({ name: 'ping', description: 'Pong', handle });
    expect(JSON.stringify(data)).toBe('{"name":"ping","description":"Pong"}');
  });

  it('maps options, a group and a loose subcommand with Discord types', () => {
    const data = toDiscordCommandData({
      name: 'mod',
      description: 'Moderation',
      options: [
        { name: 'q', description: 'Q', type: 'string', required: true, maxLength: 5 },
        { name: 'n', description: 'N', type: 'integer', minValue: 1, maxValue: 9 },
        { name: 'c', description: 'C', type: 'string', choices: ['a', 'b'] },
        { name: 'u', description: 'U', type: 'user' },
      ],
      groups: [
        {
          name: 'g',
          description: 'G',
          subcommands: [
            {
              name: 's1',
              description: 'S1',
              options: [
                { name: 'f', description: 'F', type: 'boolean' },
                { name: 'ch', description: 'Ch', type: 'channel' },
                { name: 'r', description: 'R', type: 'role' },
              ],
            },
          ],
        },
      ],
      subcommands: [{ name: 's2', description: 'S2' }],
      handle,
    });
    expect(data).toEqual({
      name: 'mod',
      description: 'Moderation',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'q',
          description: 'Q',
          required: true,
          max_length: 5,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: 'n',
          description: 'N',
          min_value: 1,
          max_value: 9,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'c',
          description: 'C',
          choices: [
            { name: 'a', value: 'a' },
            { name: 'b', value: 'b' },
          ],
        },
        { type: ApplicationCommandOptionType.User, name: 'u', description: 'U' },
        {
          type: ApplicationCommandOptionType.SubcommandGroup,
          name: 'g',
          description: 'G',
          options: [
            {
              type: ApplicationCommandOptionType.Subcommand,
              name: 's1',
              description: 'S1',
              options: [
                { type: ApplicationCommandOptionType.Boolean, name: 'f', description: 'F' },
                { type: ApplicationCommandOptionType.Channel, name: 'ch', description: 'Ch' },
                { type: ApplicationCommandOptionType.Role, name: 'r', description: 'R' },
              ],
            },
          ],
        },
        { type: ApplicationCommandOptionType.Subcommand, name: 's2', description: 'S2' },
      ],
    });
  });
});

describe('dispatchCommand option passthrough', () => {
  it('hands channel, subcommand and options to the handler', async () => {
    const logger = createRecordingLogger();
    const seen: unknown[] = [];
    await dispatchCommand(
      fakeInteraction('x'),
      command('x', async (i) => {
        await Promise.resolve();
        seen.push(i.channelId, i.subcommandGroup, i.subcommand, i.options.getString('text'));
      }),
      logger,
    );
    expect(seen).toEqual(['222222222222222222', 'grp', 'sub', 'hello']);
  });
});
