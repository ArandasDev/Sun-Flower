import fs from 'node:fs';
import path from 'node:path';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import { validateManifest } from './manifest.ts';

export interface DiscoveredModule {
  readonly directory: string;
  readonly directoryName: string;
  /** The `id` found in manifest.json when it is a string, even if the manifest is invalid. */
  rawId?: string;
  manifest?: ModuleManifest;
  errors: string[];
}

function rawId(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

export function discoverModules(modulesDir: string, coreApiVersion: string): DiscoveredModule[] {
  if (!fs.existsSync(modulesDir)) return [];

  const modules: DiscoveredModule[] = [];
  const ids = new Map<string, DiscoveredModule[]>();

  const names = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directoryName of names) {
    const directory = path.join(modulesDir, directoryName);
    const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const entry: DiscoveredModule = { directory, directoryName, errors: [] };
    modules.push(entry);

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      entry.errors.push(
        error instanceof SyntaxError
          ? 'manifest.json is not valid JSON'
          : 'manifest.json cannot be read',
      );
      continue;
    }

    const result = validateManifest(raw, directoryName, coreApiVersion);
    if (result.ok) entry.manifest = result.manifest;
    else entry.errors.push(...result.errors);

    const id = rawId(raw);
    if (id !== undefined) {
      entry.rawId = id;
      ids.set(id, [...(ids.get(id) ?? []), entry]);
    }
  }

  for (const [id, owners] of ids) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      owner.errors.push(`duplicate module id "${id}"`);
      delete owner.manifest;
    }
  }
  return modules;
}
