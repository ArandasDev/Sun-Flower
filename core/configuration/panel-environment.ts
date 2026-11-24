import { isIP } from 'node:net';

import { z } from 'zod';

import { parse, type Source } from './environment.ts';

export interface PanelEnvironment {
  /** The public origin, without a trailing slash. */
  readonly publicUrl: string;
  readonly port: number;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sessionSecret: Buffer;
  readonly trustProxy: string[];
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** An IP, or IP/CIDR with a prefix length above zero that fits the address family. */
function isTrustedProxyEntry(entry: string): boolean {
  const slash = entry.indexOf('/');
  if (slash === -1) return isIP(entry) !== 0;
  const family = isIP(entry.slice(0, slash));
  const prefix = entry.slice(slash + 1);
  if (family === 0 || !/^\d{1,3}$/.test(prefix)) return false;
  const length = Number(prefix);
  return length > 0 && length <= (family === 4 ? 32 : 128);
}

const publicUrl = z.string().transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      value.includes('?') ||
      value.includes('#')
    ) {
      ctx.addIssue({ code: 'custom', message: 'invalid' });
      return z.NEVER;
    }
    return url.origin;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid' });
    return z.NEVER;
  }
});

const sessionSecret = z
  .string()
  .regex(BASE64)
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((bytes) => bytes.length >= 32);

const panelSchema = z.object({
  PANEL_PUBLIC_URL: publicUrl,
  PANEL_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((port) => port >= 1 && port <= 65535)
    .default(3000),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  DISCORD_CLIENT_SECRET: z.string(),
  SESSION_SECRET: sessionSecret,
  PANEL_TRUST_PROXY: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    )
    .refine((items) => items.every(isTrustedProxyEntry))
    .default([]),
});

const NAMES = [
  'PANEL_PUBLIC_URL',
  'PANEL_PORT',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'SESSION_SECRET',
  'PANEL_TRUST_PROXY',
];

/**
 * Reads the panel variables. Returns null when PANEL_PUBLIC_URL is absent (panel off); throws an
 * EnvironmentError naming the invalid variables, never their values.
 */
export function loadPanelEnvironment(env: Source): PanelEnvironment | null {
  const raw = env['PANEL_PUBLIC_URL']?.trim();
  if (raw === undefined || raw === '') return null;
  const parsed = parse(panelSchema, env, NAMES);
  return {
    publicUrl: parsed.PANEL_PUBLIC_URL,
    port: parsed.PANEL_PORT,
    clientId: parsed.DISCORD_CLIENT_ID,
    clientSecret: parsed.DISCORD_CLIENT_SECRET,
    sessionSecret: parsed.SESSION_SECRET,
    trustProxy: parsed.PANEL_TRUST_PROXY,
  };
}
