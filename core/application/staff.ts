import { fileURLToPath } from 'node:url';
import { CORE_API_VERSION } from '../../shared/contracts/module.ts';
import type { Logger } from '../../shared/contracts/logger.ts';
import { EnvironmentError, loadDatabaseEnvironment } from '../configuration/environment.ts';
import { openDatabase } from '../infrastructure/database.ts';
import { createLogger } from '../infrastructure/logger.ts';
import { MIGRATIONS_DIR, runMigrations } from '../infrastructure/migrations.ts';
import { discoverModules } from '../module-registry/discovery.ts';
import {
  CorePermissionGrantError,
  InvalidPermissionError,
  InvalidSnowflakeError,
  isValidPermission,
  PermissionService,
} from '../permissions/permission-service.ts';

const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));

export const STAFF_USAGE =
  'Uso: npm run staff -- add|remove|list [userId] | grant|revoke <permissão> <roleId> | grants';

export interface StaffDeps {
  readonly permissions: PermissionService;
  readonly logger: Logger;
  /** Permissions declared by the valid manifests in `modules/`. */
  readonly declaredPermissions: () => ReadonlySet<string>;
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

function grantPermission(permission: string, roleId: string, deps: StaffDeps): number {
  const { permissions, logger, out } = deps;
  try {
    permissions.grant(permission, roleId);
  } catch (error) {
    if (error instanceof InvalidSnowflakeError) out('ID de cargo inválido.');
    else if (error instanceof InvalidPermissionError) out('Permissão inválida.');
    else if (error instanceof CorePermissionGrantError) {
      out('Permissões core.* não podem ser associadas a cargos.');
    } else throw error;
    return 2;
  }
  // The role id stays out of the log, like user ids.
  logger.info({ action: 'grant', permission }, 'role grant updated');
  out('Permissão associada ao cargo.');
  if (!deps.declaredPermissions().has(permission)) {
    out('Aviso: nenhum módulo declara esta permissão.');
  }
  return 0;
}

function revokePermission(permission: string, roleId: string, deps: StaffDeps): number {
  const { permissions, logger, out } = deps;
  const existed = permissions
    .listGrants()
    .some((grant) => grant.permission === permission && grant.roleId === roleId);
  try {
    permissions.revoke(permission, roleId);
  } catch (error) {
    if (!(error instanceof InvalidSnowflakeError)) throw error;
    out('ID de cargo inválido.');
    return 2;
  }
  if (!isValidPermission(permission)) {
    out('Permissão inválida.');
    return 2;
  }
  logger.info({ action: 'revoke', permission }, 'role grant updated');
  out(existed ? 'Permissão removida do cargo.' : 'Nenhuma associação.');
  return 0;
}

/** Runs one `staff` action and returns the process exit code. */
export function runStaff(args: string[], deps: StaffDeps): number {
  const [action, userId, roleId, ...rest] = args;
  if (roleId === undefined && (action === 'add' || action === 'remove') && userId !== undefined) {
    return changeDevelopers(action, userId, deps);
  }
  if (action === 'list' && userId === undefined) {
    const developers = deps.permissions.listDevelopers();
    if (developers.length === 0) deps.out('Nenhum desenvolvedor.');
    for (const developer of developers) deps.out(`${developer.userId} ${developer.addedAt}`);
    return 0;
  }
  if (rest.length === 0 && userId !== undefined && roleId !== undefined) {
    if (action === 'grant') return grantPermission(userId, roleId, deps);
    if (action === 'revoke') return revokePermission(userId, roleId, deps);
  }
  if (action === 'grants' && userId === undefined) {
    const grants = deps.permissions.listGrants();
    if (grants.length === 0) deps.out('Nenhuma associação.');
    for (const grant of grants) deps.out(`${grant.permission} ${grant.roleId} ${grant.grantedAt}`);
    return 0;
  }
  deps.out(STAFF_USAGE);
  return 2;
}

/** Reads the valid manifests only; module entrypoints are never imported. */
function declaredPermissions(): Set<string> {
  const declared = new Set<string>();
  for (const entry of discoverModules(MODULES_DIR, CORE_API_VERSION)) {
    for (const permission of entry.manifest?.permissions ?? []) declared.add(permission);
  }
  return declared;
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
      declaredPermissions: () => declaredPermissions(),
      out: (line) => {
        console.log(line);
      },
    });
  } finally {
    db.close();
  }
}

if (import.meta.main) main();
