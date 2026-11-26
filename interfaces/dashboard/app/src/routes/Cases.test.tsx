import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate } from '../components/CaseDetail.tsx';
import { FakeClock, FakeWebSocket, lastSocket } from '../fake-websocket.ts';
import { me, renderApp, stubFetch, type FakeResponse } from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const TARGET = '222222222222222222';

function summary(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'automatic',
    level: 'confirmed',
    action: 'delete_timeout',
    status: 'actioned',
    targetUserId: TARGET,
    rules: [],
    createdAt: '2026-11-20T10:00:00.000Z',
    ...extra,
  };
}

function detail(id: number, extra: Record<string, unknown> = {}) {
  return {
    ...summary(id),
    actorUserId: null,
    channelId: '333333333333333333',
    domains: ['exemplo.test'],
    signals: [],
    rules: [],
    score: 7,
    reason: 'Link suspeito',
    outcome: {},
    timeoutUntil: null,
    revertedBy: null,
    revertedAt: null,
    ...extra,
  };
}

const READ = 'moderation.cases.read';
const REVERT = 'moderation.cases.revert';
/** The revert or dismiss confirmation; the case detail Sheet is a dialog too. */
const CONFIRMATION = /^(Reverter|Descartar) o caso 5\?$/;

interface Call {
  name: string;
  input: Record<string, unknown>;
}

function setup(permissions: string[], operation: (call: Call) => FakeResponse, path = '/casos') {
  const calls: Call[] = [];
  const clock = new FakeClock();
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
    return { status: 404, body: { error: { code: 'not_found', message: 'x' } } };
  });
  const view = renderApp(path, clock);
  return { ...view, calls, clock };
}

const ok = (data: unknown): FakeResponse => ({ status: 200, body: { data } });

function standard(call: Call): FakeResponse {
  if (call.name === 'moderation.cases.list') {
    return ok({
      cases: [summary(5), summary(4, { kind: 'manual', level: null })],
      nextCursor: null,
    });
  }
  if (call.name === 'moderation.cases.view') {
    return ok(detail(Number(call.input['id']), { status: 'open' }));
  }
  if (call.name === 'moderation.cases.revert') {
    return ok({
      case: detail(Number(call.input['id']), { status: 'reverted' }),
      deletedMessage: false,
    });
  }
  return ok(null);
}

describe('cases list', () => {
  it('lists the cases', async () => {
    setup([READ], standard);
    expect(await screen.findByRole('button', { name: /Caso 5/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Caso 4/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument();
  });

  it('keeps the row accessible name, separators included', async () => {
    setup([READ], standard);
    const row = await screen.findByRole('button', { name: /Caso 5/ });
    expect(row).toHaveAccessibleName(
      `Caso 5${formatDate('2026-11-20T10:00:00.000Z')}, Automático, confirmadoApagar e silenciar, Com ação aplicada${TARGET}`,
    );
  });

  it('hides the Casos menu item without moderation.cases.read', async () => {
    setup([], standard, '/');
    await screen.findByRole('heading', { level: 1, name: 'Meu perfil' });
    expect(screen.queryByRole('link', { name: 'Casos' })).toBeNull();
  });

  it('shows the Casos menu item with moderation.cases.read', async () => {
    setup([READ], standard, '/');
    expect(await screen.findByRole('link', { name: 'Casos' })).toHaveAttribute('href', '/casos');
  });

  it('refetches with the right parameters when a filter changes', async () => {
    const { calls } = setup([READ], standard);
    await screen.findByRole('button', { name: /Caso 5/ });
    await userEvent.selectOptions(screen.getByLabelText('Situação'), 'open');
    await userEvent.selectOptions(screen.getByLabelText('Regra'), 'flood');
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        name: 'moderation.cases.list',
        input: { status: 'open', rule: 'flood' },
      }),
    );
    await userEvent.type(screen.getByLabelText('ID do alvo'), TARGET);
    await waitFor(() =>
      expect(calls.at(-1)?.input).toEqual({ status: 'open', rule: 'flood', targetUserId: TARGET }),
    );
  });

  it('reads the filters from the URL', async () => {
    const { calls } = setup([READ], standard, '/casos?situacao=reverted');
    await screen.findByRole('button', { name: /Caso 5/ });
    expect(calls[0]?.input).toEqual({ status: 'reverted' });
    expect(screen.getByLabelText('Situação')).toHaveValue('reverted');
  });

  it('does not send an invalid target id', async () => {
    const { calls } = setup([READ], standard);
    await screen.findByRole('button', { name: /Caso 5/ });
    await userEvent.type(screen.getByLabelText('ID do alvo'), '123');
    expect(screen.getByText('Use de 17 a 20 dígitos.')).toBeInTheDocument();
    expect(calls.every((call) => call.input['targetUserId'] === undefined)).toBe(true);
  });

  it('loads more with the cursor', async () => {
    const { calls } = setup([READ], (call) => {
      if (call.name === 'moderation.cases.list') {
        return call.input['cursor'] === 4
          ? ok({ cases: [summary(3)], nextCursor: null })
          : ok({ cases: [summary(5), summary(4)], nextCursor: 4 });
      }
      return standard(call);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('button', { name: /Caso 3/ })).toBeInTheDocument();
    expect(calls.some((call) => call.input['cursor'] === 4)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('shows "Sem permissão." on a 403', async () => {
    setup([READ], () => ({
      status: 403,
      body: { error: { code: 'forbidden', message: 'Você não tem permissão para isso.' } },
    }));
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument();
  });

  it('refreshes the list on case.created', async () => {
    let listed = 0;
    setup([READ], (call) => {
      if (call.name === 'moderation.cases.list') {
        listed += 1;
        return ok({
          cases: listed === 1 ? [summary(5)] : [summary(6), summary(5)],
          nextCursor: null,
        });
      }
      return standard(call);
    });
    await screen.findByRole('button', { name: /Caso 5/ });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
      lastSocket().receive('case.created', { caseId: 6 });
    });
    expect(await screen.findByRole('button', { name: /Caso 6/ })).toBeInTheDocument();
  });

  it('refetches only the first page, at most twice, for a burst of 20 case.created in 5 s', async () => {
    const { calls, clock } = setup([READ], (call) => {
      if (call.name === 'moderation.cases.list') {
        return call.input['cursor'] === 4
          ? ok({ cases: [summary(3)], nextCursor: null })
          : ok({ cases: [summary(5), summary(4)], nextCursor: 4 });
      }
      return standard(call);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await screen.findByRole('button', { name: /Caso 3/ });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
    });
    const lists = () => calls.filter((call) => call.name === 'moderation.cases.list');
    const before = lists().length;
    for (let index = 0; index < 20; index += 1) {
      act(() => {
        lastSocket().receive('case.created', { caseId: 100 + index });
        clock.advance(200);
      });
    }
    await waitFor(() => expect(lists().length).toBe(before + 1));
    act(() => {
      clock.advance(5_000);
    });
    await waitFor(() => expect(lists().length).toBe(before + 2));
    act(() => {
      clock.advance(60_000);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const refetches = lists().slice(before);
    expect(refetches).toHaveLength(2);
    expect(refetches.every((call) => call.input['cursor'] === undefined)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Caso 3/ })).toBeNull());
    expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeInTheDocument();
  });

  it('runs the last case.updated after the window, so no event is lost', async () => {
    const { calls, clock } = setup([READ], standard);
    await screen.findByRole('button', { name: /Caso 5/ });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
    });
    const lists = () => calls.filter((call) => call.name === 'moderation.cases.list').length;
    const before = lists();
    act(() => {
      lastSocket().receive('case.updated', { caseId: 5 });
      lastSocket().receive('case.updated', { caseId: 4 });
    });
    await waitFor(() => expect(lists()).toBe(before + 1));
    act(() => {
      clock.advance(4_999);
    });
    expect(lists()).toBe(before + 1);
    act(() => {
      clock.advance(1);
    });
    await waitFor(() => expect(lists()).toBe(before + 2));
  });

  it('clears the target field when the URL loses the filter', async () => {
    setup([READ], standard, `/casos?alvo=${TARGET}`);
    await screen.findByRole('button', { name: /Caso 5/ });
    expect(screen.getByLabelText('ID do alvo')).toHaveValue(TARGET);
    await userEvent.click(screen.getByRole('link', { name: 'Casos' }));
    await waitFor(() => expect(screen.getByLabelText('ID do alvo')).toHaveValue(''));
  });

  it('reports the cases screen in presence', async () => {
    setup([READ], standard);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
    });
    expect(lastSocket().messages()).toContainEqual({ type: 'presence', screen: 'cases' });
  });
});

describe('case detail', () => {
  async function open(permissions: string[], operation = standard) {
    const view = setup(permissions, operation);
    await userEvent.click(await screen.findByRole('button', { name: /Caso 5/ }));
    await screen.findByText('Link suspeito');
    return view;
  }

  it('shows the fields', async () => {
    await open([READ]);
    expect(screen.getByText('exemplo.test')).toBeInTheDocument();
    expect(screen.getAllByText(TARGET).length).toBeGreaterThan(0);
  });

  it('hides the actions without moderation.cases.revert', async () => {
    await open([READ]);
    expect(screen.queryByRole('button', { name: 'Reverter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull();
  });

  it('asks for confirmation, then sends { id, allowDomains }', async () => {
    const { calls } = await open([READ, REVERT]);
    await userEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.some((call) => call.name === 'moderation.cases.revert')).toBe(false);
    await userEvent.click(within(dialog).getByLabelText('Permitir também os domínios do caso'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));
    await waitFor(() =>
      expect(calls.find((call) => call.name === 'moderation.cases.revert')?.input).toEqual({
        id: 5,
        allowDomains: true,
      }),
    );
  });

  it('sends allowDomains false by default', async () => {
    const { calls } = await open([READ, REVERT]);
    await userEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));
    await waitFor(() =>
      expect(calls.find((call) => call.name === 'moderation.cases.revert')?.input).toEqual({
        id: 5,
        allowDomains: false,
      }),
    );
  });

  it('cancels with Escape without sending', async () => {
    const { calls } = await open([READ, REVERT]);
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: CONFIRMATION })).toBeNull());
    expect(calls.some((call) => call.name === 'moderation.cases.dismiss')).toBe(false);
  });

  it('dismisses after confirming', async () => {
    const { calls } = await open([READ, REVERT]);
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    await waitFor(() =>
      expect(calls.find((call) => call.name === 'moderation.cases.dismiss')?.input).toEqual({
        id: 5,
      }),
    );
  });

  it('shows the error message of a failed operation', async () => {
    await open([READ, REVERT], (call) =>
      call.name === 'moderation.cases.revert'
        ? {
            status: 409,
            body: { error: { code: 'conflict', message: 'Este caso não pode ser revertido.' } },
          }
        : standard(call),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));
    expect(await screen.findByText('Este caso não pode ser revertido.')).toBeInTheDocument();
  });
});

describe('case detail, review fixes', () => {
  async function openCase(
    permissions: string[],
    operation: (call: Call) => FakeResponse = standard,
  ) {
    const view = setup(permissions, operation);
    await userEvent.click(await screen.findByRole('button', { name: /Caso 5/ }));
    await screen.findByText('Link suspeito');
    return view;
  }

  const forbiddenRevert = (call: Call): FakeResponse =>
    call.name === 'moderation.cases.revert'
      ? {
          status: 403,
          body: { error: { code: 'forbidden', message: 'Você não tem permissão para isso.' } },
        }
      : standard(call);

  it('offers Reverter but not Descartar on an actioned case', async () => {
    await openCase([READ, REVERT], (call) =>
      call.name === 'moderation.cases.view'
        ? ok(detail(Number(call.input['id']), { status: 'actioned' }))
        : standard(call),
    );
    expect(screen.getByRole('button', { name: 'Reverter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull();
  });

  it('offers both actions on an open case', async () => {
    await openCase([READ, REVERT]);
    expect(screen.getByRole('button', { name: 'Reverter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });

  it('hides both actions on a reverted case', async () => {
    await openCase([READ, REVERT], (call) =>
      call.name === 'moderation.cases.view'
        ? ok(detail(Number(call.input['id']), { status: 'reverted' }))
        : standard(call),
    );
    expect(screen.queryByRole('button', { name: 'Reverter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull();
  });

  it('moves focus to the detail heading when a case opens', async () => {
    await openCase([READ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Caso 5' })).toHaveFocus();
  });

  it('shows "Sem permissão." in the dialog on a 403 from revert', async () => {
    await openCase([READ, REVERT], forbiddenRevert);
    await userEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));
    expect(await within(dialog).findByText('Sem permissão.')).toBeInTheDocument();
  });

  it('keeps Escape working after a failed confirm, with focus back on Cancelar', async () => {
    await openCase([READ, REVERT], forbiddenRevert);
    await userEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));
    await within(dialog).findByText('Sem permissão.');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: CONFIRMATION })).toBeNull());
  });

  it('returns focus to the opener on cancel', async () => {
    await openCase([READ, REVERT]);
    const opener = screen.getByRole('button', { name: 'Reverter' });
    await userEvent.click(opener);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: CONFIRMATION })).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('closes only the confirmation on Escape inside the detail sheet, focus back on Reverter', async () => {
    await openCase([READ, REVERT]);
    const sheet = screen.getByRole('dialog', { name: 'Caso 5' });
    const opener = within(sheet).getByRole('button', { name: 'Reverter' });
    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Reverter o caso 5?' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reverter o caso 5?' })).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: 'Caso 5' })).toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('returns focus to the detail heading after a successful revert', async () => {
    await openCase([READ, REVERT]);
    await userEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverter' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: CONFIRMATION })).toBeNull());
    expect(screen.getByRole('heading', { level: 2, name: 'Caso 5' })).toHaveFocus();
  });

  it('refreshes the list and the open case on case.updated', async () => {
    const { calls } = await openCase([READ]);
    const lists = () => calls.filter((call) => call.name === 'moderation.cases.list').length;
    const views = () => calls.filter((call) => call.name === 'moderation.cases.view').length;
    const before = { lists: lists(), views: views() };
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
      lastSocket().receive('case.updated', { caseId: 5 });
    });
    await waitFor(() => {
      expect(lists()).toBeGreaterThan(before.lists);
      expect(views()).toBeGreaterThan(before.views);
    });
  });
});

describe('list errors and target id', () => {
  it('keeps the filters visible and shows the error where the list goes', async () => {
    setup([READ], () => ({
      status: 500,
      body: { error: { code: 'failed', message: 'Erro interno.' } },
    }));
    expect(await screen.findByText('Erro interno.')).toBeInTheDocument();
    expect(screen.getByLabelText('Situação')).toBeInTheDocument();
    expect(screen.getByLabelText('ID do alvo')).toBeInTheDocument();
  });

  it('refuses a 20 digit id above the snowflake maximum', async () => {
    const { calls } = setup([READ], standard);
    await screen.findByRole('button', { name: /Caso 5/ });
    await userEvent.click(screen.getByLabelText('ID do alvo'));
    await userEvent.paste('99999999999999999999');
    expect(screen.getByText('Use de 17 a 20 dígitos.')).toBeInTheDocument();
    expect(calls.every((call) => call.input['targetUserId'] === undefined)).toBe(true);
  });
});
