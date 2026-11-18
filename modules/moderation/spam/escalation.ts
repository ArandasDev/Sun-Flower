import type { Punishment } from '../config.ts';

const MAX_TIMEOUT_MINUTES = 40320;
const MAX_STEPS = 5;

/** Higher is more severe; any timeout ranks below kick, longer timeouts above shorter ones. */
export function severity(p: Punishment): number {
  switch (p.kind) {
    case 'none':
      return 0;
    case 'timeout':
      return 1 + p.minutes / 1_000_000;
    case 'kick':
      return 2;
    case 'ban':
      return 3;
  }
}

/** Most severe punishment; ties keep the first argument; no arguments yields `none`. */
export function mostSevere(...ps: Punishment[]): Punishment {
  let best: Punishment | undefined;
  for (const p of ps) {
    if (best === undefined || severity(p) > severity(best)) best = p;
  }
  return best ?? { kind: 'none' };
}

export function escalationStep(
  steps: readonly Punishment[],
  priorActioned: number,
): { step: number; punishment: Punishment } {
  const index = Math.min(Math.max(priorActioned, 0), steps.length - 1);
  const punishment = steps[index];
  if (punishment === undefined) throw new Error('escalationStep requires at least one step');
  return { step: index + 1, punishment };
}

function parseToken(token: string): Punishment | undefined {
  if (token === 'kick') return { kind: 'kick' };
  if (token === 'ban') return { kind: 'ban' };
  const match = /^(\d+)([mh])$/.exec(token);
  if (match?.[1] === undefined) return undefined;
  const minutes = Number(match[1]) * (match[2] === 'h' ? 60 : 1);
  if (minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) return undefined;
  return { kind: 'timeout', minutes };
}

/** Parses `10m,1h,ban` into 1-5 steps; any invalid token invalidates the whole text. */
export function parseSteps(text: string): Punishment[] | undefined {
  const tokens = text.split(',').map((t) => t.trim().toLowerCase());
  if (tokens.length < 1 || tokens.length > MAX_STEPS) return undefined;
  const steps: Punishment[] = [];
  for (const token of tokens) {
    const step = parseToken(token);
    if (step === undefined) return undefined;
    steps.push(step);
  }
  return steps;
}

export function formatSteps(steps: readonly Punishment[]): string {
  return steps
    .map((p) => {
      if (p.kind === 'timeout')
        return p.minutes % 60 === 0 ? `${p.minutes / 60}h` : `${p.minutes}m`;
      return p.kind;
    })
    .join(',');
}
