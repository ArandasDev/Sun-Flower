import type { ModuleFactory } from '../../shared/contracts/module.ts';

export { configSchema } from './config.ts';

const createModeration: ModuleFactory = () => ({
  register: async () => {},
  initialize: async () => {},
  start: async () => {},
  stop: async () => {},
  dispose: async () => {},
});

export default createModeration;
