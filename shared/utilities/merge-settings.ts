const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Merges a partial settings object into the stored one. Plain objects are merged key by key at any
 * depth; lists, primitives and `null` replace the stored value. The keys `__proto__`,
 * `constructor` and `prototype` are ignored. Returns a new object; neither input is changed.
 */
export function mergeSettings(
  stored: Record<string, unknown>,
  partial: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!FORBIDDEN_KEYS.has(key))
      result[key] = isPlainObject(value) ? mergeSettings({}, value) : value;
  }
  for (const [key, value] of Object.entries(partial)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const current = result[key];
    if (isPlainObject(value)) {
      result[key] = mergeSettings(isPlainObject(current) ? current : {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
