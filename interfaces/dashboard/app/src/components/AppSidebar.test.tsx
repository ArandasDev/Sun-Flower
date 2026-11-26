import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket, lastSocket } from '../fake-websocket.ts';
import { clickSignOut, me, renderApp, stubFetch } from '../test-utils.tsx';

const ALL_PERMISSIONS = [
  'moderation.cases.read',
  'moderation.actions.warn',
  'moderation.domains.manage',
  'moderation.config.manage',
  'administration.grants.manage',
  'core.developers.manage',
  'core.modules.manage',
  'core.logs.read',
  'core.sessions.manage',
];

const ALL_ITEMS = [
  'Meu perfil',
  'Visão geral',
  'Casos',
  'Ações',
  'Domínios',
  'Configuração',
  'Permissões',
  'Desenvolvedores',
  'Módulos',
  'Logs',
  'Sessões',
];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => vi.unstubAllGlobals());

function signIn(level: string, permissions: string[] = []) {
  stubFetch((url) =>
    url === '/api/me'
      ? me(level, { permissions })
      : { status: 404, body: { error: { code: 'not_found', message: 'x' } } },
  );
}

function menu() {
  return screen.getByRole('navigation', { name: 'Principal' });
}

/** Simulates a viewport narrower than 768 px. */
function phoneViewport(): void {
  window.matchMedia = (query: string) => ({
    matches: query.includes('max-width: 767px'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

describe('sidebar groups', () => {
  it('shows a member only "Geral › Meu perfil"', async () => {
    signIn('member');
    renderApp('/');
    await screen.findByRole('link', { name: 'Meu perfil' });
    const nav = menu();
    expect(within(nav).getByText('Geral')).toBeInTheDocument();
    expect(within(nav).queryByText('Moderação')).toBeNull();
    expect(within(nav).queryByText('Administração')).toBeNull();
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Meu perfil']);
  });

  it('shows the owner holding every permission all three groups, in order', async () => {
    signIn('owner', ALL_PERMISSIONS);
    renderApp('/');
    await screen.findByRole('link', { name: 'Meu perfil' });
    const nav = menu();
    for (const group of ['Geral', 'Moderação', 'Administração']) {
      expect(within(nav).getByText(group)).toBeInTheDocument();
    }
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(ALL_ITEMS);
  });

  it('shows only the moderation group items a staff member may use', async () => {
    signIn('staff', ['moderation.cases.read']);
    renderApp('/');
    await screen.findByRole('link', { name: 'Casos' });
    const nav = menu();
    expect(within(nav).getByText('Moderação')).toBeInTheDocument();
    expect(within(nav).queryByText('Administração')).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Visão geral' })).toBeNull();
  });

  it('names the /moderacao item "Configuração"', async () => {
    signIn('staff', ['moderation.config.manage']);
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Configuração' })).toHaveAttribute(
      'href',
      '/moderacao',
    );
  });
});

describe('header', () => {
  it('shows the breadcrumb "Moderação › Casos" on /casos', async () => {
    signIn('staff', ['moderation.cases.read']);
    renderApp('/casos');
    const trail = await screen.findByRole('navigation', { name: 'Você está em' });
    expect(within(trail).getByText('Moderação')).toBeInTheDocument();
    expect(within(trail).getByText('Casos')).toHaveAttribute('aria-current', 'page');
  });

  it('shows "Ao vivo", and "Reconectando…" once the connection drops', async () => {
    signIn('member');
    renderApp('/');
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Ao vivo');
    act(() => {
      lastSocket().drop();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
  });
});

describe('collapsing', () => {
  it('stores sunflower-sidebar=collapsed and keeps every link named', async () => {
    signIn('owner', ALL_PERMISSIONS);
    const { container } = renderApp('/');
    await screen.findByRole('link', { name: 'Meu perfil' });
    await userEvent.click(screen.getByRole('button', { name: 'Alternar menu' }));
    expect(localStorage.getItem('sunflower-sidebar')).toBe('collapsed');
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-state',
      'collapsed',
    );
    for (const name of ALL_ITEMS) {
      expect(within(menu()).getByRole('link', { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Alternar menu' }));
    expect(localStorage.getItem('sunflower-sidebar')).toBe('expanded');
  });

  it('opens collapsed when that was stored', async () => {
    localStorage.setItem('sunflower-sidebar', 'collapsed');
    signIn('member');
    const { container } = renderApp('/');
    await screen.findByRole('link', { name: 'Meu perfil' });
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-state',
      'collapsed',
    );
  });

  it('opens expanded, without error, when localStorage throws', async () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
      clear: blocked,
      key: blocked,
      length: 0,
    });
    signIn('member');
    const { container } = renderApp('/');
    await screen.findByRole('link', { name: 'Meu perfil' });
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toHaveAttribute('data-state', 'expanded');
    await userEvent.click(screen.getByRole('button', { name: 'Alternar menu' }));
    expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  });
});

describe('phone drawer', () => {
  it('opens from the trigger, and choosing a screen navigates and closes it', async () => {
    phoneViewport();
    signIn('staff', ['moderation.cases.read']);
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Meu perfil' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Alternar menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Menu' });
    await userEvent.click(within(drawer).getByRole('link', { name: 'Casos' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const trail = screen.getByRole('navigation', { name: 'Você está em' });
    expect(within(trail).getByText('Casos')).toBeInTheDocument();
  });
});

describe('account menu', () => {
  it('puts the dark class on <html> when "Escuro" is chosen', async () => {
    signIn('member');
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Girassol' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Escuro' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('sunflower-theme')).toBe('dark');
  });

  it('signs out from the menu', async () => {
    const fetchMock = stubFetch((path) =>
      path === '/api/logout' ? { status: 204 } : me('member'),
    );
    renderApp('/');
    await clickSignOut();
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/logout')).toBe(true);
  });
});
