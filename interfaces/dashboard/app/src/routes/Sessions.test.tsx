import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../fake-websocket.ts';
import {
  errorBody,
  findToast,
  noToast,
  okBody,
  setupOperations,
  type OperationCall,
} from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const SELF = '111111111111111111';
const OTHER = '444444444444444444';

/** The body rows of the sessions table that show `userId`. */
const rowsOf = (userId: string): HTMLElement[] =>
  screen
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('cell').length > 0)
    .filter((row) => within(row).queryByText(userId) !== null);

/** Opens the actions menu of a session row and chooses an item. */
async function chooseAction(row: HTMLElement, item: string): Promise<void> {
  await userEvent.click(within(row).getByRole('button', { name: /^Ações da sessão de / }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

function setup(override?: (call: OperationCall) => ReturnType<typeof okBody> | undefined) {
  let sessions = [
    {
      ref: 'aaaaaaaaaaaaaaaa',
      userId: SELF,
      createdAt: '2026-01-02T03:04:00.000Z',
      lastSeenAt: '2026-01-02T05:04:00.000Z',
    },
    {
      ref: 'bbbbbbbbbbbbbbbb',
      userId: OTHER,
      createdAt: '2026-01-03T03:04:00.000Z',
      lastSeenAt: '2026-01-03T05:04:00.000Z',
    },
    {
      ref: 'cccccccccccccccc',
      userId: OTHER,
      createdAt: '2026-01-04T03:04:00.000Z',
      lastSeenAt: '2026-01-04T05:04:00.000Z',
    },
  ];
  const operation = (call: OperationCall) => {
    const custom = override?.(call);
    if (custom !== undefined) return custom;
    if (call.name === 'administration.sessions.list') return okBody({ sessions });
    if (call.name === 'administration.sessions.revoke') {
      sessions = sessions.filter((item) => item.ref !== call.input['ref']);
      return okBody({ revoked: true });
    }
    if (call.name === 'administration.sessions.revoke-all') {
      sessions = sessions.filter((item) => item.userId !== call.input['userId']);
      return okBody({ revoked: 2 });
    }
    return okBody(null);
  };
  return setupOperations(['core.sessions.manage'], operation, '/sessoes', new FakeClock());
}

describe('sessions screen', () => {
  it('lists the sessions with the person and marks the own one', async () => {
    setup();
    await screen.findByRole('table');
    const own = rowsOf(SELF);
    const other = rowsOf(OTHER);
    expect(own).toHaveLength(1);
    expect(within(own[0]!).getByText('Você')).toBeInTheDocument();
    expect(
      within(own[0]!).getByRole('button', { name: `Ações da sessão de ${SELF}` }),
    ).toBeInTheDocument();
    expect(other).toHaveLength(2);
    for (const row of other) {
      expect(within(row).queryByText('Você')).toBeNull();
      expect(
        within(row).getByRole('button', { name: `Ações da sessão de ${OTHER}` }),
      ).toBeInTheDocument();
    }
  });

  it('filters the rows by the person searched, and ends the session of a filtered row', async () => {
    const { calls } = setup();
    await screen.findByRole('table');
    await userEvent.type(screen.getByLabelText('Buscar'), OTHER);
    expect(rowsOf(SELF)).toHaveLength(0);
    const other = rowsOf(OTHER);
    expect(other).toHaveLength(2);
    // The second filtered row is not the second row of the list.
    await chooseAction(other[1]!, 'Encerrar');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((call) => call.name === 'administration.sessions.revoke')?.input).toEqual({
      ref: 'cccccccccccccccc',
    });
  });

  it('ends all sessions of the person of a filtered row from its menu', async () => {
    const { calls } = setup();
    await screen.findByRole('table');
    await userEvent.type(screen.getByLabelText('Buscar'), OTHER);
    // The first filtered row is not the first row of the list, which is the own session.
    await chooseAction(rowsOf(OTHER)[0]!, 'Encerrar todas desta pessoa');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((call) => call.name === 'administration.sessions.revoke')).toHaveLength(0);
    expect(calls.find((call) => call.name === 'administration.sessions.revoke-all')?.input).toEqual(
      { userId: OTHER },
    );
  });

  it('puts the search in the card header and marks ending all as destructive', async () => {
    setup();
    await screen.findByRole('table');
    expect(screen.getByLabelText('Buscar').closest('[data-slot="card-header"]')).not.toBeNull();
    await userEvent.click(
      within(rowsOf(OTHER)[0]!).getByRole('button', { name: `Ações da sessão de ${OTHER}` }),
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Encerrar todas desta pessoa' }),
    ).toHaveClass('text-destructive');
    expect(screen.getByRole('menuitem', { name: 'Encerrar' })).not.toHaveClass('text-destructive');
  });

  it('asks for confirmation, then sends the ref of one session', async () => {
    const { calls } = setup();
    await screen.findByRole('table');
    await chooseAction(rowsOf(OTHER)[0]!, 'Encerrar');
    expect(calls.some((call) => call.name === 'administration.sessions.revoke')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((call) => call.name === 'administration.sessions.revoke')?.input).toEqual({
      ref: 'bbbbbbbbbbbbbbbb',
    });
    expect(await findToast('Sessão revogada.')).toBeInTheDocument();
    await waitFor(() => expect(rowsOf(OTHER)).toHaveLength(1));
    // The menu and the dialog leave the page usable, with focus on the title.
    expect(document.body.style.pointerEvents).not.toBe('none');
    expect(screen.getByRole('heading', { name: 'Sessões', level: 1 })).toHaveFocus();
  });

  it('asks for confirmation, then sends the user id to end all of a person', async () => {
    const { calls } = setup();
    await screen.findByRole('table');
    await chooseAction(rowsOf(OTHER)[0]!, 'Encerrar todas desta pessoa');
    expect(calls.some((call) => call.name === 'administration.sessions.revoke-all')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(rowsOf(OTHER)).toHaveLength(0));
    expect(rowsOf(SELF)).toHaveLength(1);
    expect(await findToast('Sessão revogada.')).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'administration.sessions.revoke-all')?.input).toEqual(
      { userId: OTHER },
    );
  });

  it('shows the server text when ending a session fails, inside the dialog', async () => {
    setup((call) =>
      call.name === 'administration.sessions.revoke'
        ? errorBody(404, 'not_found', 'Sessão não encontrada.')
        : undefined,
    );
    await screen.findByRole('table');
    await chooseAction(rowsOf(OTHER)[0]!, 'Encerrar');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Encerrar' }));
    expect(await within(dialog).findByText('Sessão não encontrada.')).toBeInTheDocument();
    expect(noToast()).toBe(true);
  });

  it('reloads the list even when ending a session fails', async () => {
    const { calls } = setup((call) =>
      call.name === 'administration.sessions.revoke'
        ? errorBody(404, 'not_found', 'Sessão não encontrada.')
        : undefined,
    );
    await screen.findByRole('table');
    await chooseAction(rowsOf(OTHER)[0]!, 'Encerrar');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Encerrar' }));
    await within(dialog).findByText('Sessão não encontrada.');
    await waitFor(() =>
      expect(calls.filter((call) => call.name === 'administration.sessions.list')).toHaveLength(2),
    );
  });

  it('shows the empty text when there is no session', async () => {
    setup((call) =>
      call.name === 'administration.sessions.list' ? okBody({ sessions: [] }) : undefined,
    );
    const empty = await screen.findByText('Nenhuma sessão aberta.');
    expect(empty.closest('.border-dashed')).not.toBeNull();
  });

  it('shows "Sem permissão." on a 403', async () => {
    setup((call) =>
      call.name === 'administration.sessions.list'
        ? errorBody(403, 'forbidden', 'Você não tem permissão para isso.')
        : undefined,
    );
    const message = await screen.findByText('Sem permissão.');
    expect(message.closest('[data-slot="alert"]')).toHaveAttribute('role', 'alert');
  });
});
