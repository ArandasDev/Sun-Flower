import type { DatabaseSync } from 'node:sqlite';

import type { ModuleStorage, SqlValue } from '../../shared/contracts/storage.ts';

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function createModuleStorage(db: DatabaseSync): ModuleStorage {
  const bind = (params: readonly SqlValue[] | undefined): SqlValue[] => [...(params ?? [])];

  return {
    run(sql, params) {
      const result = db.prepare(sql).run(...bind(params));
      return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
    },
    get<T>(sql: string, params?: readonly SqlValue[]): T | undefined {
      return db.prepare(sql).get(...bind(params)) as T | undefined;
    },
    all<T>(sql: string, params?: readonly SqlValue[]): T[] {
      return db.prepare(sql).all(...bind(params)) as T[];
    },
    transaction<T>(fn: () => T): T {
      if (db.isTransaction) throw new Error('nested transactions are not supported');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        // An async callback would commit before its awaited work ran: refuse it.
        if (isThenable(result)) throw new Error('transaction callback must be synchronous');
        db.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
