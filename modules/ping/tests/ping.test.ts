import { describe, expect, it } from 'vitest';

import type { CommandDefinition } from '../../../shared/contracts/commands.ts';
import type { ModuleContext } from '../../../shared/contracts/module.ts';
import { createRecordingLogger } from '../../../tests/helpers/recording-logger.ts';
import createPing from '../index.ts';

function fakeContext(registered: CommandDefinition[]): ModuleContext {
  return {
    moduleId: 'ping',
    logger: createRecordingLogger(),
    events: { publish: () => {}, subscribe: () => {} },
    permissions: { check: () => false, isDeveloper: () => false, hasAnyGrant: () => false },
    config: { get: <T>() => ({}) as T, set: () => {} },
    guild: {} as ModuleContext['guild'],
    storage: {} as ModuleContext['storage'],
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
      channelId: '111111111111111111',
      subcommandGroup: undefined,
      subcommand: undefined,
      options: {
        getString: () => undefined,
        getInteger: () => undefined,
        getBoolean: () => undefined,
        getUser: () => undefined,
        getChannel: () => undefined,
        getRole: () => undefined,
      },
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
