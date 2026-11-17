export type SqlValue = string | number | bigint | null;

export interface ModuleStorage {
  run(
    sql: string,
    params?: readonly SqlValue[],
  ): { readonly changes: number; readonly lastInsertRowid: number | bigint };
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
}
