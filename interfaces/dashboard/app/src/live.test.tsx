import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeWebSocket, lastSocket } from './fake-websocket.ts';
import { makeCoalescer, screenFor } from './live.ts';
import { clickSignOut, me, renderApp, stubFetch, type FakeResponse } from './test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const unauthorized: FakeResponse = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'x' } },
};

let clock: FakeClock;
beforeEach(() => {
  clock = new FakeClock();
});

/** Renders as `level`, waits for the socket and opens it. */
async function start(level: string, path = '/', extra: Record<string, unknown> = {}) {
  const fetchMock = stubFetch((url) => (url === '/api/status' ? unauthorized : me(level, extra)));
  const view = renderApp(path, clock);
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  act(() => {
    lastSocket().open();
  });
  return { ...view, fetchMock };
}

function drop(code?: number): void {
  act(() => {
    lastSocket().drop(code);
  });
}

describe('connection', () => {
  it('does not open the socket on the login screen', async () => {
    stubFetch(() => unauthorized);
    renderApp('/login', clock);
    await screen.findByRole('link', { name: 'Entrar com Discord' });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('does not open the socket when /api/me failed', async () => {
    stubFetch(() => unauthorized);
    renderApp('/', clock);
    await screen.findByRole('link', { name: 'Entrar com Discord' });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('opens ws:// on the same host once signed in', async () => {
    await start('member');
    expect(lastSocket().url).toBe(`ws://${location.host}/api/live`);
  });

  it('shows "Ao vivo" while connected, and "Reconectando…" after a drop', async () => {
    await start('member');
    expect(screen.getByRole('status')).toHaveTextContent('Ao vivo');
    drop();
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
  });

  it('waits 1 s, 2 s, 4 s… up to 30 s between attempts', async () => {
    await start('member');
    const delays: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      drop();
      const [delay] = clock.pendingDelays();
      delays.push(delay ?? -1);
      const before = FakeWebSocket.instances.length;
      act(() => {
        clock.advance(delay ?? 0);
      });
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('starts over at 1 s after a successful reconnection and invalidates every query', async () => {
    const { fetchMock } = await start('member');
    drop();
    drop(); // a stray second close event must not stack timers
    expect(clock.pendingDelays()).toEqual([1_000]);
    act(() => {
      clock.advance(1_000);
    });
    drop();
    expect(clock.pendingDelays()).toEqual([2_000]);
    act(() => {
      clock.advance(2_000);
    });
    const meCalls = () => fetchMock.mock.calls.filter(([path]) => path === '/api/me').length;
    const before = meCalls();
    act(() => {
      lastSocket().open();
    });
    expect(meCalls()).toBe(before);
    act(() => {
      clock.advance(5_000);
    });
    await waitFor(() => expect(meCalls()).toBe(before + 1));
    expect(screen.getByRole('status')).toHaveTextContent('Ao vivo');
    drop();
    expect(clock.pendingDelays()).toEqual([1_000]);
  });

  it('keeps doubling when the server accepts and closes at once (6th tab)', async () => {
    const { fetchMock } = await start('member');
    const meCalls = () => fetchMock.mock.calls.filter(([path]) => path === '/api/me').length;
    const before = meCalls();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      drop(4408);
      const [delay] = clock.pendingDelays();
      delays.push(delay ?? -1);
      act(() => {
        clock.advance(delay ?? 0);
      });
      act(() => {
        lastSocket().open();
      });
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
    await Promise.resolve();
    expect(meCalls()).toBe(before);
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
  });

  describe('probe after a close that never opened', () => {
    let mode: 'ok' | '503' | 'network' | '401';
    async function startWithProbe() {
      mode = 'ok';
      const fetchMock = vi.fn((url: string) => {
        if (url !== '/api/me') return Promise.resolve(new Response(null, { status: 404 }));
        if (mode === 'network') return Promise.reject(new TypeError('Failed to fetch'));
        const { status, body } =
          mode === '503'
            ? { status: 503, body: { error: { code: 'unavailable', message: 'x' } } }
            : mode === '401'
              ? unauthorized
              : me('member');
        return Promise.resolve(new Response(JSON.stringify(body), { status }));
      });
      vi.stubGlobal('fetch', fetchMock);
      const view = renderApp('/', clock);
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      act(() => {
        lastSocket().open();
      });
      drop();
      return { ...view, fetchMock };
    }

    it.each(['503', 'network'] as const)(
      'keeps the shell, the banner and the retries while /api/me fails with %s',
      async (failure) => {
        const { fetchMock } = await startWithProbe();
        mode = failure;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const [delay] = clock.pendingDelays();
          act(() => {
            clock.advance(delay ?? 0);
          });
          const calls = fetchMock.mock.calls.length;
          drop(); // the new socket never opened
          await waitFor(() => expect(fetchMock.mock.calls.length).toBe(calls + 1));
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
          expect(screen.getByRole('button', { name: 'Girassol' })).toBeInTheDocument();
          expect(screen.queryByText('Tentar de novo')).toBeNull();
          expect(clock.pendingDelays()).toHaveLength(1);
        }
        expect(FakeWebSocket.instances).toHaveLength(4);
      },
    );

    it('goes to the login when the probe answers 401, without retrying', async () => {
      await startWithProbe();
      mode = '401';
      act(() => {
        clock.advance(1_000);
      });
      drop();
      expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
      expect(clock.pendingDelays()).toEqual([]);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });
  });

  it('RequireSession keeps the shell when a refetch of /api/me fails with 503', async () => {
    let failing = false;
    stubFetch(() =>
      failing
        ? { status: 503, body: { error: { code: 'unavailable', message: 'x' } } }
        : me('member'),
    );
    const { client } = renderApp('/', clock);
    await screen.findByRole('button', { name: 'Girassol' });
    failing = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['me'] });
    });
    expect(screen.getByRole('button', { name: 'Girassol' })).toBeInTheDocument();
    expect(screen.queryByText('Tentar de novo')).toBeNull();
  });

  it('keeps the status region in the accessibility tree while connected', async () => {
    await start('member');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('unmounting stops the retry and send timers', async () => {
    const { unmount } = await start('owner');
    await userEvent.click(screen.getByRole('link', { name: 'Visão geral' }));
    drop();
    expect(clock.pendingDelays().length).toBeGreaterThan(0);
    unmount();
    expect(clock.pendingDelays()).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('unmounting while a send is pending leaves no timers', async () => {
    const { unmount } = await start('owner');
    await userEvent.click(screen.getByRole('link', { name: 'Visão geral' }));
    expect(clock.pendingDelays().length).toBeGreaterThan(0); // send + stable timers
    unmount();
    expect(clock.pendingDelays()).toEqual([]);
  });

  it.each([4400, 4408])('reconnects after close code %i', async (code) => {
    await start('member');
    drop(code);
    expect(clock.pendingDelays()).toEqual([1_000]);
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
  });

  it('does not reconnect after 4401: clears the cache and goes to the login', async () => {
    const { client } = await start('member');
    client.setQueryData(['config', 'moderation'], { a: 1 });
    drop(4401);
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
    expect(clock.pendingDelays()).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.getQueryData(['config', 'moderation'])).toBeUndefined();
    expect(client.getQueryData(['me'])).toBeUndefined();
  });

  it('session.ended clears the whole cache and goes to the login without reconnecting', async () => {
    const { client } = await start('member');
    client.setQueryData(['config', 'moderation'], { a: 1 });
    act(() => {
      lastSocket().receive('session.ended', null);
    });
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
    expect(clock.pendingDelays()).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.getQueryData(['config', 'moderation'])).toBeUndefined();
  });

  it('logging out clears the whole cache', async () => {
    stubFetch((url) => (url === '/api/logout' ? { status: 204 } : me('member')));
    const { client } = renderApp('/', clock);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    client.setQueryData(['config', 'moderation'], { a: 1 });
    await clickSignOut();
    await screen.findByRole('link', { name: 'Entrar com Discord' });
    expect(client.getQueryData(['config', 'moderation'])).toBeUndefined();
  });

  it('the login screen clears the cache when it mounts', async () => {
    stubFetch(() => unauthorized);
    const { client } = renderApp('/', clock); // /api/me answers 401, so the login mounts
    client.setQueryData(['config', 'moderation'], { a: 1 });
    await screen.findByRole('link', { name: 'Entrar com Discord' });
    await waitFor(() => expect(client.getQueryData(['config', 'moderation'])).toBeUndefined());
  });

  it('a 401 from any query clears the whole cache', async () => {
    let signedIn = true;
    stubFetch((url) => {
      if (url === '/api/status') {
        signedIn = false;
        return unauthorized;
      }
      return signedIn ? me('owner') : unauthorized;
    });
    const { client } = renderApp('/visao-geral', clock);
    client.setQueryData(['config', 'moderation'], { a: 1 });
    await screen.findByRole('link', { name: 'Entrar com Discord' });
    expect(client.getQueryData(['config', 'moderation'])).toBeUndefined();
  });

  it('closes the socket when leaving', async () => {
    await start('member');
    const socket = lastSocket();
    await clickSignOut();
    await screen.findByRole('link', { name: 'Entrar com Discord' });
    expect(socket.readyState).toBe(3);
  });
});

describe('messages', () => {
  it('config.changed invalidates [config, moduleId] only', async () => {
    const { client } = await start('member');
    client.setQueryData(['config', 'moderation'], { a: 1 });
    client.setQueryData(['config', 'phishing'], { a: 1 });
    act(() => {
      lastSocket().receive('config.changed', { moduleId: 'moderation', version: 3 });
    });
    expect(client.getQueryState(['config', 'moderation'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['config', 'phishing'])?.isInvalidated).toBe(false);
  });

  it('status updates the [status] query', async () => {
    const { client } = await start('member');
    const status = { connection: 'ready', uptimeMs: 1, modules: [] };
    act(() => {
      lastSocket().receive('status', status);
    });
    expect(client.getQueryData(['status'])).toEqual(status);
  });

  it('ignores a status message with the wrong shape', async () => {
    const { client } = await start('member');
    act(() => {
      lastSocket().receive('status', { connection: 'ready', uptimeMs: '1', modules: [] });
      lastSocket().receive('status', { connection: 'ready', uptimeMs: 1, modules: [{ id: 1 }] });
      lastSocket().receive('status', null);
    });
    expect(client.getQueryData(['status'])).toBeUndefined();
  });

  it('ignores malformed messages', async () => {
    await start('member');
    act(() => {
      lastSocket().onmessage?.({ data: 'not json' });
      lastSocket().receive('presence', { users: 'nope' });
      lastSocket().receive('mystery', {});
    });
    expect(screen.getByRole('status')).toHaveTextContent('Ao vivo');
  });
});

describe('presence messages sent', () => {
  it('sends the screen when the socket opens', async () => {
    await start('owner');
    expect(lastSocket().messages()).toEqual([{ type: 'presence', screen: 'profile' }]);
  });

  it('sends the new screen on a route change, at most once per 1100 ms', async () => {
    await start('owner');
    await userEvent.click(screen.getByRole('link', { name: 'Visão geral' }));
    expect(lastSocket().messages()).toHaveLength(1);
    act(() => {
      clock.advance(1_099);
    });
    expect(lastSocket().messages()).toHaveLength(1);
    act(() => {
      clock.advance(1);
    });
    expect(lastSocket().messages()).toEqual([
      { type: 'presence', screen: 'profile' },
      { type: 'presence', screen: 'overview' },
    ]);
  });

  it('sends nothing when quick changes end on the screen already reported', async () => {
    await start('owner');
    await userEvent.click(screen.getByRole('link', { name: 'Visão geral' }));
    await userEvent.click(screen.getByRole('link', { name: 'Meu perfil' }));
    act(() => {
      clock.advance(5_000);
    });
    expect(lastSocket().messages()).toEqual([{ type: 'presence', screen: 'profile' }]);
  });

  it('sends the current screen again on a new connection', async () => {
    await start('owner');
    drop();
    act(() => {
      clock.advance(1_000);
    });
    act(() => {
      lastSocket().open();
    });
    expect(lastSocket().messages()).toEqual([{ type: 'presence', screen: 'profile' }]);
  });
});

describe('presence list', () => {
  const ana = {
    userId: '222222222222222222',
    screen: 'overview',
    name: 'Ana',
    avatarUrl: 'https://cdn.discordapp.com/avatars/2/a.png',
  };
  const self = {
    userId: '111111111111111111',
    screen: 'profile',
    name: 'Girassol',
    avatarUrl: null,
  };
  const bia = { userId: '333333333333333333', screen: 'profile', name: 'Bia', avatarUrl: null };

  it('lists the people online with their screen as accessible names', async () => {
    await start('owner');
    act(() => {
      lastSocket().receive('presence', { users: [self, ana, bia] });
    });
    const list = screen.getByRole('list', { name: 'Quem está online' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Ana — Visão geral',
      'Bia — Meu perfil',
    ]);
    expect(items[0]?.querySelector('img')).toHaveAttribute('src', ana.avatarUrl);
  });

  it('shows a tooltip with name and screen, reachable by focus', async () => {
    await start('owner');
    act(() => {
      lastSocket().receive('presence', { users: [ana] });
    });
    const item = screen.getByLabelText('Ana — Visão geral');
    expect(item).toHaveAttribute('tabindex', '0');
    const tip = item.querySelector('[role="tooltip"]');
    expect(tip).toHaveTextContent('Ana — Visão geral');
    // Only this seed opens it: the sidebar wrapper is an unnamed `group` too.
    expect(item).toHaveClass('group/seed');
    expect(tip).toHaveClass('group-hover/seed:block', 'group-focus-visible/seed:block');
    expect(tip?.className).not.toMatch(/(^|s)group-(hover|focus-visible):/);
  });

  it('says so when nobody else is online', async () => {
    await start('owner');
    expect(screen.getByText('Só você por aqui agora.')).toBeInTheDocument();
    act(() => {
      lastSocket().receive('presence', { users: [self] });
    });
    expect(screen.getByText('Só você por aqui agora.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Quem está online' })).toBeNull();
  });

  it('removes someone who leaves', async () => {
    await start('owner');
    act(() => {
      lastSocket().receive('presence', { users: [self, ana] });
    });
    expect(screen.getByLabelText('Ana — Visão geral')).toBeInTheDocument();
    act(() => {
      lastSocket().receive('presence', { users: [self] });
    });
    await waitFor(() => expect(screen.queryByLabelText('Ana — Visão geral')).toBeNull());
  });

  it('is shown to a staff member with a named permission', async () => {
    await start('staff', '/', { permissions: ['moderation.config.manage'] });
    expect(screen.getByText('Só você por aqui agora.')).toBeInTheDocument();
  });

  it('is not shown to a member', async () => {
    await start('member');
    act(() => {
      lastSocket().receive('presence', { users: [ana] });
    });
    expect(screen.queryByText('Só você por aqui agora.')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Quem está online' })).toBeNull();
    expect(screen.queryByLabelText('Ana — Visão geral')).toBeNull();
  });
});

describe('screenFor', () => {
  it.each([
    ['/acoes', 'actions'],
    ['/dominios', 'domains'],
    ['/moderacao', 'moderation-config'],
    ['/casos', 'cases'],
    ['/permissoes', 'grants'],
    ['/desenvolvedores', 'developers'],
    ['/modulos', 'modules'],
    ['/logs', 'logs'],
    ['/sessoes', 'sessions'],
  ])('maps %s to %s', (path, screen) => {
    expect(screenFor(path)).toBe(screen);
  });
});

describe('makeCoalescer', () => {
  it('runs a key at once, then once at the end of its window with the last request', () => {
    const coalescer = makeCoalescer(clock, 5_000);
    const runs: string[] = [];
    coalescer.request('cases', () => runs.push('a'));
    coalescer.request('cases', () => runs.push('b'));
    coalescer.request('cases', () => runs.push('c'));
    coalescer.request('case:5', () => runs.push('x'));
    expect(runs).toEqual(['a', 'x']);
    clock.advance(4_999);
    expect(runs).toEqual(['a', 'x']);
    clock.advance(1);
    expect(runs).toEqual(['a', 'x', 'c']);
    clock.advance(5_000);
    coalescer.request('cases', () => runs.push('d'));
    expect(runs).toEqual(['a', 'x', 'c', 'd']);
  });

  it('stop drops what is waiting', () => {
    const coalescer = makeCoalescer(clock, 5_000);
    const runs: string[] = [];
    coalescer.request('cases', () => runs.push('a'));
    coalescer.request('cases', () => runs.push('b'));
    coalescer.stop();
    expect(clock.pendingDelays()).toEqual([]);
    clock.advance(10_000);
    expect(runs).toEqual(['a']);
  });
});
