import type { ModuleFactory } from '../../shared/contracts/module.ts';
import { registerAdministrationOperations } from './operations.ts';

/** Stateless: every operation delegates to the Core's `admin` service. */
const createAdministration: ModuleFactory = () => ({
  register: async (ctx) => {
    await Promise.resolve();
    registerAdministrationOperations(ctx);
  },
  initialize: async () => {
    await Promise.resolve();
  },
  start: async () => {
    await Promise.resolve();
  },
  stop: async () => {
    await Promise.resolve();
  },
  dispose: async () => {
    await Promise.resolve();
  },
});

export default createAdministration;
