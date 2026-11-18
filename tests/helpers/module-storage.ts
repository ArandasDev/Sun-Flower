import { basename, join } from 'node:path';

import { openDatabase } from '../../core/infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../core/infrastructure/migrations.ts';
import { createModuleStorage } from '../../core/storage/module-storage.ts';
import { applyModuleMigrations } from '../../core/storage/module-migrations.ts';
import type { ModuleStorage } from '../../shared/contracts/storage.ts';

/** In-memory storage with the Core and the module migrations applied. */
export function createTestModuleStorage(moduleDir: string): {
  storage: ModuleStorage;
  close(): void;
} {
  const db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  applyModuleMigrations(db, basename(moduleDir), join(moduleDir, 'migrations'));
  return { storage: createModuleStorage(db), close: () => db.close() };
}
