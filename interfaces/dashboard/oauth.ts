import type { PanelEnvironment } from '../../core/configuration/panel-environment.ts';
import type { OAuthClient } from './ports.ts';

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const USER_URL = 'https://discord.com/api/v10/users/@me';
const TIMEOUT_MS = 10_000;
const SNOWFLAKE = /^\d{17,20}$/;

/** A Discord OAuth2 failure. The message is fixed: never the response, the code or a token. */
export class OAuthError extends Error {
  constructor(step: 'exchange' | 'user') {
    super(step === 'exchange' ? 'Discord code exchange failed' : 'Discord user lookup failed');
    this.name = 'OAuthError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return undefined;
  }
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The Discord authorization-code flow with PKCE and the `identify` scope. The redirect URI comes
 * only from the configured public URL. `fetchImpl` is injectable for tests.
 */
export function createDiscordOAuth(
  env: PanelEnvironment,
  fetchImpl: typeof fetch = fetch,
): OAuthClient {
  const redirectUri = `${env.publicUrl}/auth/callback`;
  return {
    authorizeUrl(state, challenge) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: env.clientId,
        scope: 'identify',
        state,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchange(code, verifier) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      });
      let response: Response;
      try {
        response = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new OAuthError('exchange');
      }
      if (!response.ok) throw new OAuthError('exchange');
      const accessToken = field(await readJson(response), 'access_token');
      if (typeof accessToken !== 'string' || accessToken === '') throw new OAuthError('exchange');
      return accessToken;
    },

    async fetchUserId(accessToken) {
      let response: Response;
      try {
        response = await fetchImpl(USER_URL, {
          headers: { authorization: `Bearer ${accessToken}` },
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new OAuthError('user');
      }
      if (!response.ok) throw new OAuthError('user');
      const id = field(await readJson(response), 'id');
      if (typeof id !== 'string' || !SNOWFLAKE.test(id)) throw new OAuthError('user');
      return id;
    },
  };
}
