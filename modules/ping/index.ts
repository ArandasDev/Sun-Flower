import type { ModuleFactory } from '../../shared/contracts/module.ts';

const createPing: ModuleFactory = () => ({
  register: async (context) => {
    await Promise.resolve();
    context.commands.register({
      name: 'ping',
      description: 'Verifica se o Sun Flower está respondendo.',
      handle: (interaction) => interaction.reply('Pong!'),
    });
  },
  initialize: async () => {},
  start: async () => {},
  stop: async () => {},
  dispose: async () => {},
});

export default createPing;
