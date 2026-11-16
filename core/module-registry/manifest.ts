import path from 'node:path';
import { z } from 'zod';
import type { ModuleManifest } from '../../shared/contracts/module.ts';
import { isApiCompatible } from '../../shared/utilities/semver.ts';

const MODULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const THREE_SEGMENTS = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

function isConfinedPath(value: string): boolean {
  const unified = value.replaceAll('\\', '/');
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) return false;
  return !path.posix.normalize(unified).split('/').includes('..');
}

const manifestSchema = z.strictObject({
  id: z.string().regex(MODULE_ID, 'id must be kebab-case'),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(SEMVER, 'version must be SemVer (MAJOR.MINOR.PATCH)'),
  apiVersion: z.string().regex(SEMVER, 'apiVersion must be SemVer (MAJOR.MINOR.PATCH)'),
  entrypoint: z.string().min(1).refine(isConfinedPath, {
    message: 'entrypoint must be a relative path inside the module directory',
  }),
  dependencies: z.array(z.string().regex(MODULE_ID, 'dependency must be a module id')),
  permissions: z.array(
    z.string().regex(THREE_SEGMENTS, 'permission must have the format module.resource.action'),
  ),
  enabledByDefault: z.boolean().default(false),
  events: z
    .strictObject({
      subscribes: z
        .array(z.string().regex(THREE_SEGMENTS, 'event must have the format module.subject.action'))
        .default([]),
      publishes: z
        .array(z.string().regex(THREE_SEGMENTS, 'event must have the format module.subject.action'))
        .default([]),
    })
    .default({ subscribes: [], publishes: [] }),
});

// Compile-time guard: the parsed manifest must stay assignable to ModuleManifest.
type ParsedManifest = z.output<typeof manifestSchema>;
const _assignable = (parsed: ParsedManifest): ModuleManifest => parsed;
void _assignable;

export type ManifestValidation =
  { ok: true; manifest: ModuleManifest } | { ok: false; errors: string[] };

function describeIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.join('.');
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((key) => [...issue.path, key].join('.')).join(', ');
    return `unrecognized field: ${keys}`;
  }
  return where ? `${where}: ${issue.message}` : issue.message;
}

export function validateManifest(
  raw: unknown,
  directoryName: string,
  coreApiVersion: string,
): ManifestValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map(describeIssue) };
  }

  const manifest = parsed.data;
  const errors: string[] = [];
  if (manifest.id !== directoryName) {
    errors.push(`id "${manifest.id}" must match the directory name "${directoryName}"`);
  }
  if (!isApiCompatible(coreApiVersion, manifest.apiVersion)) {
    errors.push(
      `apiVersion ${manifest.apiVersion} is not compatible with core API ${coreApiVersion}`,
    );
  }
  const prefix = `${manifest.id}.`;
  for (const permission of manifest.permissions) {
    if (!permission.startsWith(prefix)) {
      errors.push(`permission "${permission}" must start with "${prefix}"`);
    }
  }
  for (const event of manifest.events.publishes) {
    if (!event.startsWith(prefix)) {
      errors.push(`published event "${event}" must start with "${prefix}"`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, manifest };
}
