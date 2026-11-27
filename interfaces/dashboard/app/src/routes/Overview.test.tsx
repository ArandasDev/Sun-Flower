import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeWebSocket, lastSocket } from '../fake-websocket.ts';
import { me, renderApp, stubFetch } from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const STATUS = {
  connection: 'ready',
  uptimeMs: 3_600_000,
  modules: [
    { id: 'core', state: 'RUNNING' },
    { id: 'moderation', state: 'RUNNING' },
    { id: 'logs', state: 'FAILED' },
  ],
};

const person = (userId: string, name: string) => ({
  userId,
  screen: 'overview',
  name,
  avatarUrl: null,
});

async function start(permissions: string[]) {
  stubFetch((url) =>
    url === '/api/status' ? { status: 200, body: STATUS } : me('owner', { permissions }),
  );
  renderApp('/visao-geral', new FakeClock());
  await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
  await screen.findByText('Módulos ativos');
}

/** The indicator card whose label is `label`. */
const indicator = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe('overview indicators', () => {
  it('counts only RUNNING modules as active', async () => {
    await start([]);
    expect(indicator('Módulos ativos')).toHaveTextContent('2 de 3');
  });

  it('shows the connection and the uptime', async () => {
    await start([]);
    expect(indicator('Conexão')).toHaveTextContent('Conectado');
    expect(indicator('Tempo no ar')).toHaveTextContent('1 h 0 min');
  });

  it('counts the people on the panel from the presence', async () => {
    await start([]);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
    });
    act(() => {
      lastSocket().receive('presence', {
        users: [person('222222222222222222', 'Ana'), person('333333333333333333', 'Bia')],
      });
    });
    await waitFor(() => expect(indicator('No painel agora')).toHaveTextContent('2'));
  });
});

describe('overview modules card', () => {
  it('shows each module with its state', async () => {
    await start([]);
    const list = within(
      screen.getByRole('heading', { name: 'Módulos' }).closest('[data-slot="card"]') as HTMLElement,
    );
    expect(list.getAllByRole('listitem')).toHaveLength(3);
    expect(list.getByText('Com falha')).toBeInTheDocument();
  });

  it('links to Módulos only with core.modules.manage', async () => {
    await start(['core.modules.manage']);
    expect(screen.getByRole('link', { name: 'Gerenciar módulos' })).toHaveAttribute(
      'href',
      '/modulos',
    );
  });

  it('hides the link without the permission', async () => {
    await start([]);
    expect(screen.queryByRole('link', { name: 'Gerenciar módulos' })).toBeNull();
  });
});
