import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfToken, setCsrfToken } from './api.ts';
import { runOperation } from './operations.ts';

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown) {
  const fn = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('runOperation', () => {
  it('posts the input as JSON to /api/operations/<name> and returns data', async () => {
    resetCsrfToken();
    setCsrfToken('csrf-1');
    const fn = stub(200, { data: { ok: 1 } });
    await expect(runOperation('moderation.cases.view', { id: 3 })).resolves.toEqual({ ok: 1 });
    const [path, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/operations/moderation.cases.view');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"id":3}');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-csrf-token')).toBe('csrf-1');
  });

  it('sends an empty object body when there is no input', async () => {
    const fn = stub(200, { data: null });
    await runOperation('moderation.cases.mine', {});
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{}');
  });

  it('throws ApiError with the server code and message', async () => {
    stub(409, { error: { code: 'conflict', message: 'Caso já revertido.' } });
    await expect(runOperation('x.y.z', {})).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'Caso já revertido.',
    });
  });
});
