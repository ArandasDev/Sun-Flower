export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseSemver(value: string): Semver | null {
  const match = SEMVER.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** A module is compatible when it targets the same major and a version not newer than the core. */
export function isApiCompatible(core: string, module: string): boolean {
  const c = parseSemver(core);
  const m = parseSemver(module);
  if (!c || !m || c.major !== m.major) return false;
  if (m.minor !== c.minor) return m.minor < c.minor;
  return m.patch <= c.patch;
}
