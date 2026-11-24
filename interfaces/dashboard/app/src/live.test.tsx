import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeWebSocket, lastSocket } from './fake-websocket.ts';
import { me, renderApp, stubFetch, type FakeResponse } from './test-utils.tsx';

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

  it('shows no banner while connected, and "Reconectando…" after a drop', async () => {
    await start('member');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
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
    await waitFor(() => expect(meCalls()).toBe(before + 1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    drop();
    expect(clock.pendingDelays()).toEqual([1_000]);
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
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    await screen.findByRole('link', { name: 'Entrar com Discord' });
    expect(client.getQueryData(['config', 'moderation'])).toBeUndefined();
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
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
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

  it('ignores malformed messages', async () => {
    await start('member');
    act(() => {
      lastSocket().onmessage?.({ data: 'not json' });
      lastSocket().receive('presence', { users: 'nope' });
      lastSocket().receive('mystery', {});
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
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
    expect(item.querySelector('[role="tooltip"]')).toHaveTextContent('Ana — Visão geral');
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
