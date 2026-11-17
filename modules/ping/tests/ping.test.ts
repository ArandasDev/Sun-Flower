import { describe, expect, it } from 'vitest';

import type { CommandDefinition } from '../../../shared/contracts/commands.ts';
import type { Logger } from '../../../shared/contracts/logger.ts';
import type { ModuleContext } from '../../../shared/contracts/module.ts';
import createPing from '../index.ts';

function silentLogger(): Logger {
  const noop = (): void => {};
  const logger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger;
}

function fakeContext(registered: CommandDefinition[]): ModuleContext {
  return {
    moduleId: 'ping',
    logger: silentLogger(),
    events: { publish: () => {}, subscribe: () => {} },
    permissions: { check: () => false },
    config: { get: <T>() => ({}) as T },
    commands: {
      register: (command) => {
        registered.push(command);
      },
    },
  };
}

describe('ping module', () => {
  it('registers /ping and answers Pong!', async () => {
    const registered: CommandDefinition[] = [];
    const module = createPing();
    await module.register(fakeContext(registered));
    await module.initialize();
    await module.start();

    expect(registered.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: 'ping', description: 'Verifica se o Sun Flower está respondendo.' },
    ]);

    const replies: string[] = [];
    await registered[0]?.handle({
      actor: { userId: '000000000000000000', roleIds: [] },
      reply: async (content) => {
        await Promise.resolve();
        replies.push(content);
      },
    });
    expect(replies).toEqual(['Pong!']);

    await module.stop();
    await module.dispose();
  });
});
