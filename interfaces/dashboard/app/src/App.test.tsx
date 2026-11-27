import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusRefetchInterval } from './routes/Overview.tsx';
import { clickSignOut, me, okBody, renderApp, setupOperations, stubFetch } from './test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const unauthorized = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'Entre para continuar.' } },
};

const retryText = 'Não foi possível confirmar seu acesso agora. Tente de novo em instantes.';

describe('login', () => {
  it('has a sign-in button that goes to /auth/login', () => {
    stubFetch(() => unauthorized);
    renderApp('/login');
    expect(screen.getByRole('link', { name: 'Entrar com Discord' })).toHaveAttribute(
      'href',
      '/auth/login',
    );
  });

  it.each([
    [
      'dev_not_member',
      'Desenvolvedores precisam ser membros do servidor para acessar o painel. Isso faz parte da segurança do projeto: limita o estrago se uma conta for invadida.',
    ],
    ['not_member', 'Só membros do servidor podem acessar o painel.'],
    ['retry', retryText],
    ['failed', 'Não foi possível entrar. Tente de novo.'],
  ])('shows the exact text for ?error=%s', (code, text) => {
    stubFetch(() => unauthorized);
    renderApp(`/login?error=${code}`);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows no error text without ?error=', () => {
    stubFetch(() => unauthorized);
    renderApp('/login');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('session', () => {
  it('sends a 401 on /api/me to the login screen', async () => {
    stubFetch(() => unauthorized);
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
  });

  it('shows the 503 message with a retry button instead of the login screen', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1
        ? { status: 503, body: { error: { code: 'unavailable', message: retryText } } }
        : me('member');
    });
    renderApp('/');
    expect(await screen.findByText(retryText)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Entrar com Discord' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Membro')).toBeInTheDocument();
  });

  it('logs out with the CSRF token and goes to /login', async () => {
    const fetchMock = stubFetch((path) =>
      path === '/api/logout' ? { status: 204 } : me('member'),
    );
    renderApp('/');
    await clickSignOut();
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([path]) => path === '/api/logout');
    expect(call?.[1]?.method).toBe('POST');
    expect(new Headers(call?.[1]?.headers).get('X-CSRF-Token')).toBe('csrf-token-1');
  });
});

describe('logout failure', () => {
  it.each([500, 403])('stays in the shell with an alert when logout answers %i', async (status) => {
    stubFetch((path) =>
      path === '/api/logout'
        ? { status, body: { error: { code: 'x', message: 'x' } } }
        : me('member'),
    );
    renderApp('/');
    await clickSignOut();
    expect(await screen.findByText('Não foi possível sair. Tente de novo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conta de Girassol' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Entrar com Discord' })).toBeNull();
  });

  it('leaves for /login when logout answers 401', async () => {
    stubFetch((path) =>
      path === '/api/logout'
        ? { status: 401, body: { error: { code: 'x', message: 'x' } } }
        : me('member'),
    );
    renderApp('/');
    await clickSignOut();
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
  });
});

describe('menu', () => {
  it('hides "Visão geral" from a member and always shows "Meu perfil"', async () => {
    stubFetch(() => me('member'));
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Meu perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Visão geral' })).toBeNull();
  });

  it.each(['owner', 'developer'])('shows "Visão geral" to %s', async (level) => {
    stubFetch(() => me(level));
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Visão geral' })).toBeInTheDocument();
  });

  it('marks the current page with aria-current', async () => {
    stubFetch(() => me('owner'));
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Meu perfil' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('routing and labels', () => {
  it('redirects unknown routes to /', async () => {
    stubFetch(() => me('member'));
    renderApp('/nao-existe');
    const link = await screen.findByRole('link', { name: 'Meu perfil' });
    // The menu renders before the redirect lands, so wait for the link to become current.
    await waitFor(() => expect(link).toHaveAttribute('aria-current', 'page'));
  });

  it('falls back to "Membro" for an unknown level', async () => {
    stubFetch(() => me('martian'));
    renderApp('/');
    expect(await screen.findByText('Membro')).toBeInTheDocument();
  });

  it('ignores the server text on 503 and shows the fixed one', async () => {
    stubFetch(() => ({
      status: 503,
      body: { error: { code: 'unavailable', message: 'texto do servidor' } },
    }));
    renderApp('/');
    expect(await screen.findByText(retryText)).toBeInTheDocument();
    expect(screen.queryByText('texto do servidor')).toBeNull();
  });
});

describe('profile', () => {
  it('shows name, id and the level in Portuguese', async () => {
    stubFetch(() => me('member'));
    renderApp('/');
    expect(await screen.findByText('Membro')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Girassol')).toBeInTheDocument();
    expect(screen.getByText('111111111111111111')).toBeInTheDocument();
  });

  it.each([
    ['developer', 'Desenvolvedor'],
    ['owner', 'Dono'],
    ['staff', 'Equipe'],
  ])('labels %s as %s', async (level, label) => {
    stubFetch(() => me(level));
    renderApp('/');
    expect(await screen.findByText(label)).toBeInTheDocument();
  });
});

describe('overview', () => {
  it('shows connection, uptime and modules', async () => {
    stubFetch((path) =>
      path === '/api/status'
        ? {
            status: 200,
            body: {
              connection: 'ready',
              uptimeMs: 2 * 3_600_000 + 5 * 60_000,
              modules: [
                { id: 'moderation', state: 'RUNNING' },
                { id: 'phishing', state: 'FAILED' },
                { id: 'misc', state: 'STOPPED' },
              ],
            },
          }
        : me('owner'),
    );
    renderApp('/visao-geral');
    expect(await screen.findByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('2 h 5 min')).toBeInTheDocument();
    expect(screen.getByText('moderation')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('Com falha')).toBeInTheDocument();
    expect(screen.getByText('Parado')).toBeInTheDocument();
  });

  it('sends a 401 on /api/status to the login screen', async () => {
    let signedIn = true;
    const gone = { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } };
    stubFetch((path) => {
      if (path === '/api/status') {
        signedIn = false;
        return gone;
      }
      return signedIn ? me('owner') : gone;
    });
    renderApp('/visao-geral');
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
  });

  it('stops polling once the status query errored', () => {
    expect(statusRefetchInterval({ state: { status: 'error' } })).toBe(false);
    expect(statusRefetchInterval({ state: { status: 'success' } })).toBe(15_000);
  });

  it('shows "Sem permissão." on a 403', async () => {
    stubFetch((path) =>
      path === '/api/status'
        ? { status: 403, body: { error: { code: 'forbidden', message: 'Sem permissão.' } } }
        : me('member'),
    );
    renderApp('/visao-geral');
    await waitFor(() => expect(screen.getByText('Sem permissão.')).toBeInTheDocument());
  });
});

describe('menu: administration items', () => {
  it('shows each item only with its permission', async () => {
    setupOperations(['administration.grants.manage'], () => okBody({ cases: [] }), '/');
    expect(await screen.findByRole('link', { name: 'Permissões' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Desenvolvedores' })).toBeNull();
  });

  it('shows the developers item with core.developers.manage only', async () => {
    setupOperations(['core.developers.manage'], () => okBody({ cases: [] }), '/');
    expect(await screen.findByRole('link', { name: 'Desenvolvedores' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Permissões' })).toBeNull();
  });
});

describe('menu: module, log and session items', () => {
  it.each([
    ['core.modules.manage', 'Módulos'],
    ['core.logs.read', 'Logs'],
    ['core.sessions.manage', 'Sessões'],
  ])('shows the item of %s only with that permission', async (permission, label) => {
    setupOperations([permission], () => okBody({ cases: [] }), '/');
    expect(await screen.findByRole('link', { name: label })).toBeInTheDocument();
    for (const other of ['Módulos', 'Logs', 'Sessões']) {
      if (other !== label) expect(screen.queryByRole('link', { name: other })).toBeNull();
    }
  });
});
