import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MotionConfig } from 'motion/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from './App.tsx';
import { resetCsrfToken } from './api.ts';

export interface FakeResponse {
  status: number;
  body?: unknown;
}
export type Handler = (path: string, init: RequestInit | undefined) => FakeResponse;

export function me(level: string, extra: Record<string, unknown> = {}): FakeResponse {
  return {
    status: 200,
    body: {
      id: '111111111111111111',
      name: 'Girassol',
      avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
      level,
      permissions: [],
      csrfToken: 'csrf-token-1',
      ...extra,
    },
  };
}

/** Replaces `fetch` with a fake that answers from `handler` and records every call. */
export function stubFetch(handler: Handler) {
  const fn = vi.fn((input: string, init?: RequestInit) => {
    const { status, body } = handler(input, init);
    return Promise.resolve(
      new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderApp(path: string) {
  resetCsrfToken();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </MotionConfig>
    </QueryClientProvider>,
  );
}
