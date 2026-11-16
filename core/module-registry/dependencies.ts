import type { ModuleManifest } from '../../shared/contracts/module.ts';

export interface ResolvedOrder {
  readonly order: string[];
  readonly failed: Map<string, string>;
}

/**
 * Orders modules so dependencies come first (Kahn's algorithm). Ties are broken by
 * alphabetical id, so the result is deterministic. Modules with a missing dependency,
 * in a cycle, or depending on a failed module are reported in `failed` with the reason.
 */
export function resolveOrder(manifests: readonly ModuleManifest[]): ResolvedOrder {
  const deps = new Map<string, string[]>();
  for (const manifest of manifests) {
    deps.set(manifest.id, [...new Set(manifest.dependencies)].sort());
  }
  const ids = [...deps.keys()].sort();
  const failed = new Map<string, string>();

  const propagate = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of ids) {
        if (failed.has(id)) continue;
        const bad = (deps.get(id) ?? []).find((dep) => failed.has(dep));
        if (bad !== undefined) {
          failed.set(id, `dependency "${bad}" failed`);
          changed = true;
        }
      }
    }
  };

  for (const id of ids) {
    const missing = (deps.get(id) ?? []).find((dep) => !deps.has(dep));
    if (missing !== undefined) failed.set(id, `missing dependency "${missing}"`);
  }
  propagate();

  const pending = new Map<string, number>();
  for (const id of ids) {
    if (!failed.has(id)) pending.set(id, deps.get(id)?.length ?? 0);
  }
  const order: string[] = [];
  const ready = ids.filter((id) => pending.get(id) === 0);
  while (ready.length > 0) {
    ready.sort();
    const id = ready.shift() as string;
    order.push(id);
    for (const other of pending.keys()) {
      if (deps.get(other)?.includes(id)) {
        const left = (pending.get(other) ?? 0) - 1;
        pending.set(other, left);
        if (left === 0) ready.push(other);
      }
    }
  }

  const unresolved = new Set([...pending.keys()].filter((id) => !order.includes(id)));
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(deps.get(from) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (next === target) return true;
      if (seen.has(next) || !unresolved.has(next)) continue;
      seen.add(next);
      stack.push(...(deps.get(next) ?? []));
    }
    return false;
  };
  for (const id of ids) {
    if (unresolved.has(id) && reaches(id, id)) failed.set(id, 'circular dependency');
  }
  propagate();

  return { order, failed };
}
