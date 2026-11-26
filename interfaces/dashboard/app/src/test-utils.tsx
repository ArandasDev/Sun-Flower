import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'motion/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from './App.tsx';
import { resetCsrfToken } from './api.ts';
import type { LiveClock } from './live.ts';
import { makeQueryClient } from './query-client.ts';

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

export function renderApp(path: string, clock?: LiveClock) {
  resetCsrfToken();
  const client = makeQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={[path]}>
          <App {...(clock === undefined ? {} : { clock })} />
        </MemoryRouter>
      </MotionConfig>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** Opens the account menu (named after the signed-in person, "Girassol") and picks "Sair". */
export async function clickSignOut(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Girassol' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Sair' }));
}

export interface OperationCall {
  name: string;
  input: Record<string, unknown>;
}

export const okBody = (data: unknown): FakeResponse => ({ status: 200, body: { data } });

export const errorBody = (status: number, code: string, message: string): FakeResponse => ({
  status,
  body: { error: { code, message } },
});

/** Renders `path` as a staff member holding `permissions`; `operation` answers each module operation. */
export function setupOperations(
  permissions: string[],
  operation: (call: OperationCall) => FakeResponse,
  path: string,
  clock?: LiveClock,
) {
  const calls: OperationCall[] = [];
  stubFetch((url, init) => {
    if (url === '/api/me') return me('staff', { permissions });
    if (url.startsWith('/api/operations/')) {
      const call = {
        name: url.slice('/api/operations/'.length),
        input: JSON.parse(init?.body as string) as Record<string, unknown>,
      };
      calls.push(call);
      return operation(call);
    }
    return errorBody(404, 'not_found', 'x');
  });
  return { ...renderApp(path, clock), calls };
}

/** A toast's text, looked up by its title so Radix's visually hidden announcement does not count. */
export const findToast = (text: string) =>
  screen.findByText(text, { selector: '[data-slot="toast-title"]' });

/** True when no toast is on screen. */
export const noToast = (): boolean => document.querySelector('[data-slot="toast"]') === null;
