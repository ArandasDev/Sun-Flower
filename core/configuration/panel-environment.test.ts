import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { EnvironmentError } from './environment.ts';
import { loadPanelEnvironment } from './panel-environment.ts';

const secret = randomBytes(32).toString('base64');
const valid = {
  PANEL_PUBLIC_URL: 'https://painel.example.com',
  DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_CLIENT_SECRET: 'fake-client-secret',
  SESSION_SECRET: secret,
};

function failedVariables(env: Record<string, string | undefined>): string[] {
  try {
    loadPanelEnvironment(env);
  } catch (e) {
    expect(e).toBeInstanceOf(EnvironmentError);
    return [...(e as EnvironmentError).variables];
  }
  throw new Error('expected loadPanelEnvironment to throw');
}

describe('loadPanelEnvironment', () => {
  it('returns null without PANEL_PUBLIC_URL', () => {
    expect(loadPanelEnvironment({})).toBeNull();
    expect(loadPanelEnvironment({ ...valid, PANEL_PUBLIC_URL: '  ' })).toBeNull();
  });

  it('loads a valid configuration with defaults', () => {
    const env = loadPanelEnvironment(valid);
    expect(env).toEqual({
      publicUrl: 'https://painel.example.com',
      port: 3000,
      clientId: '111111111111111111',
      clientSecret: 'fake-client-secret',
      sessionSecret: Buffer.from(secret, 'base64'),
      trustProxy: [],
    });
  });

  it('turns a trailing slash into a bare origin', () => {
    expect(
      loadPanelEnvironment({ ...valid, PANEL_PUBLIC_URL: 'https://painel.example.com/' })
        ?.publicUrl,
    ).toBe('https://painel.example.com');
  });

  it.each([
    'http://painel.example.com',
    'https://painel.example.com/painel',
    'https://painel.example.com/?x=1',
    'https://painel.example.com/#a',
    'not a url',
  ])('rejects PANEL_PUBLIC_URL %s', (url) => {
    expect(failedVariables({ ...valid, PANEL_PUBLIC_URL: url })).toEqual(['PANEL_PUBLIC_URL']);
  });

  it.each(['0', '65536', '30.5', 'abc'])('rejects PANEL_PORT %s', (port) => {
    expect(failedVariables({ ...valid, PANEL_PORT: port })).toEqual(['PANEL_PORT']);
  });

  it('reads PANEL_PORT', () => {
    expect(loadPanelEnvironment({ ...valid, PANEL_PORT: '8080' })?.port).toBe(8080);
  });

  it('rejects a session secret shorter than 32 bytes', () => {
    const short = randomBytes(31).toString('base64');
    expect(failedVariables({ ...valid, SESSION_SECRET: short })).toEqual(['SESSION_SECRET']);
    expect(failedVariables({ ...valid, SESSION_SECRET: '!!not-base64!!' })).toEqual([
      'SESSION_SECRET',
    ]);
  });

  it('reports every invalid variable and never leaks values', () => {
    const run = () =>
      loadPanelEnvironment({
        ...valid,
        DISCORD_CLIENT_ID: 'leaky-id',
        DISCORD_CLIENT_SECRET: '   ',
        SESSION_SECRET: 'leaky-secret',
      });
    try {
      run();
      throw new Error('expected throw');
    } catch (e) {
      const err = e as EnvironmentError;
      expect([...err.variables].sort()).toEqual([
        'DISCORD_CLIENT_ID',
        'DISCORD_CLIENT_SECRET',
        'SESSION_SECRET',
      ]);
      expect(err.message).toContain('DISCORD_CLIENT_SECRET');
      expect(err.message).not.toContain('leaky');
    }
  });

  it('parses PANEL_TRUST_PROXY as a comma-separated list', () => {
    expect(
      loadPanelEnvironment({ ...valid, PANEL_TRUST_PROXY: '127.0.0.1, ::1' })?.trustProxy,
    ).toEqual(['127.0.0.1', '::1']);
    expect(loadPanelEnvironment({ ...valid, PANEL_TRUST_PROXY: '' })?.trustProxy).toEqual([]);
  });
});
