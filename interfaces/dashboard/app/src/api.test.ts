import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, resetCsrfToken, setCsrfToken } from './api.ts';
import { stubFetch } from './test-utils.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  resetCsrfToken();
});

describe('apiFetch', () => {
  it('sends the CSRF token on mutating methods only', async () => {
    const fetchMock = stubFetch(() => ({ status: 204 }));
    setCsrfToken('csrf-token-1');
    await apiFetch('/api/logout', { method: 'POST' });
    await apiFetch('/api/status');
    const post = fetchMock.mock.calls[0]?.[1];
    const get = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(post?.headers).get('X-CSRF-Token')).toBe('csrf-token-1');
    expect(new Headers(post?.headers).get('Content-Type')).toBe('application/json');
    expect(post?.credentials).toBe('same-origin');
    expect(new Headers(get?.headers).get('X-CSRF-Token')).toBeNull();
  });

  it('throws ApiError with status, code and message', async () => {
    stubFetch(() => ({
      status: 403,
      body: { error: { code: 'forbidden', message: 'Sem permissão.' } },
    }));
    const error = await apiFetch('/api/status').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'Sem permissão.' });
  });

  it('returns undefined for 204', async () => {
    stubFetch(() => ({ status: 204 }));
    await expect(apiFetch('/api/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});
