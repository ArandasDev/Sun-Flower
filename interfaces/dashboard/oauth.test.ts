import { describe, expect, it } from 'vitest';

import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import { createDiscordOAuth } from './oauth.ts';

const env: PanelEnvironment = {
  publicUrl: 'https://painel.example.com',
  port: 3000,
  clientId: '444444444444444444',
  clientSecret: 'fake-client-secret-value',
  sessionSecret: Buffer.alloc(32, 7),
  trustProxy: [],
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
    const next = responses.shift();
    return next === undefined ? Promise.reject(new Error('no response')) : Promise.resolve(next);
  };
  return { fetch: impl, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createDiscordOAuth', () => {
  it('builds the authorize URL from the public URL with identify and S256', () => {
    const url = new URL(createDiscordOAuth(env).authorizeUrl('the-state', 'the-challenge'));
    expect(url.origin).toBe('https://discord.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: env.clientId,
      scope: 'identify',
      state: 'the-state',
      redirect_uri: 'https://painel.example.com/auth/callback',
      code_challenge: 'the-challenge',
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code with the verifier and a timeout', async () => {
    const { fetch, calls } = fakeFetch([json({ access_token: 'tok', token_type: 'Bearer' })]);
    const token = await createDiscordOAuth(env, fetch).exchange('the-code', 'the-verifier');
    expect(token).toBe('tok');
    const [call] = calls;
    expect(call?.url).toBe('https://discord.com/api/v10/oauth2/token');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(call?.init.redirect).toBe('error');
    const body = new URLSearchParams(call?.init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'https://painel.example.com/auth/callback',
      client_id: env.clientId,
      client_secret: env.clientSecret,
    });
  });

  it('throws a generic error when the exchange is refused', async () => {
    const { fetch } = fakeFetch([json({ error: 'invalid_grant', secret: 'echoed' }, 400)]);
    const error = await createDiscordOAuth(env, fetch)
      .exchange('code-value', 'verifier-value')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toMatch(/echoed|invalid_grant|-value/);
  });

  it('throws when the token response has no access token', async () => {
    const { fetch } = fakeFetch([json({ token_type: 'Bearer' })]);
    await expect(createDiscordOAuth(env, fetch).exchange('c', 'v')).rejects.toThrow();
  });

  it('reads only the user ID with the bearer token', async () => {
    const { fetch, calls } = fakeFetch([json({ id: '111111111111111111', username: 'x' })]);
    const id = await createDiscordOAuth(env, fetch).fetchUserId('tok');
    expect(id).toBe('111111111111111111');
    expect(calls[0]?.url).toBe('https://discord.com/api/v10/users/@me');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer tok');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a user response without a valid ID', async () => {
    const { fetch } = fakeFetch([json({ id: 'not-a-snowflake' })]);
    await expect(createDiscordOAuth(env, fetch).fetchUserId('tok')).rejects.toThrow();
    const failing = fakeFetch([json({}, 401)]);
    await expect(createDiscordOAuth(env, failing.fetch).fetchUserId('tok')).rejects.toThrow();
  });
});
