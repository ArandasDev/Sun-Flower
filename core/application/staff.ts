import type { Logger } from '../../shared/contracts/logger.ts';
import { EnvironmentError, loadDatabaseEnvironment } from '../configuration/environment.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { createLogger } from '../infrastructure/logger.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { InvalidSnowflakeError, PermissionService } from '../permissions/permission-service.ts';

export const STAFF_USAGE = 'Uso: npm run staff -- add|remove|list [userId]';

export interface StaffDeps {
  readonly permissions: PermissionService;
  readonly logger: Logger;
  /** Receives the lines shown to the person running the command. */
  readonly out: (line: string) => void;
}

function changeDevelopers(
  action: 'add' | 'remove',
  userId: string,
  { permissions, logger, out }: StaffDeps,
): number {
  let changed: boolean;
  try {
    changed =
      action === 'add' ? permissions.addDeveloper(userId) : permissions.removeDeveloper(userId);
  } catch (error) {
    if (!(error instanceof InvalidSnowflakeError)) throw error;
    out('ID de usuário inválido.');
    return 2;
  }
  // The user id stays out of the log: local logs may be shared when debugging.
  logger.info({ action, changed }, 'developer list updated');
  if (action === 'add') out(changed ? 'Desenvolvedor adicionado.' : 'Já era desenvolvedor.');
  else out(changed ? 'Desenvolvedor removido.' : 'Não era desenvolvedor.');
  return 0;
}

/** Runs one `staff` action and returns the process exit code. */
export function runStaff(args: string[], deps: StaffDeps): number {
  const [action, userId, ...rest] = args;
  if (rest.length === 0 && (action === 'add' || action === 'remove') && userId !== undefined) {
    return changeDevelopers(action, userId, deps);
  }
  if (action === 'list' && userId === undefined) {
    const developers = deps.permissions.listDevelopers();
    if (developers.length === 0) deps.out('Nenhum desenvolvedor.');
    for (const developer of developers) deps.out(`${developer.userId} ${developer.addedAt}`);
    return 0;
  }
  deps.out(STAFF_USAGE);
  return 2;
}

function main(): void {
  let environment;
  try {
    environment = loadDatabaseEnvironment(process.env);
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  // Logs go to stderr so stdout carries only the lines meant for the person.
  const logger = createLogger({ level: environment.logLevel, destination: process.stderr });
  const db = openDatabase(environment.dbPath);
  try {
    runMigrations(db, MIGRATIONS_DIR);
    process.exitCode = runStaff(process.argv.slice(2), {
      permissions: new PermissionService(db),
      logger,
      out: (line) => {
        console.log(line);
      },
    });
  } finally {
    db.close();
  }
}

if (import.meta.main) main();
