import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../fake-websocket.ts';
import { errorBody, okBody, setupOperations, type OperationCall } from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const SELF = '111111111111111111';
const OTHER = '444444444444444444';
const NEW_ID = '555555555555555555';
const SELF_CONFLICT = 'Você não pode remover a si mesmo dos desenvolvedores.';

function setup(override?: (call: OperationCall) => ReturnType<typeof okBody> | undefined) {
  let developers = [
    { userId: SELF, addedAt: '2026-01-02T03:04:00.000Z' },
    { userId: OTHER, addedAt: '2026-01-03T03:04:00.000Z' },
  ];
  const operation = (call: OperationCall) => {
    const custom = override?.(call);
    if (custom !== undefined) return custom;
    if (call.name === 'administration.developers.list') return okBody({ developers });
    if (call.name === 'administration.developers.add') {
      developers = [
        ...developers,
        { userId: String(call.input['userId']), addedAt: '2026-01-04T03:04:00.000Z' },
      ];
      return okBody({ added: true });
    }
    if (call.name === 'administration.developers.remove') {
      developers = developers.filter((item) => item.userId !== call.input['userId']);
      return okBody({ removed: true });
    }
    return okBody(null);
  };
  return setupOperations(
    ['core.developers.manage'],
    operation,
    '/desenvolvedores',
    new FakeClock(),
  );
}

describe('developers screen', () => {
  it('lists the developers and marks the own row', async () => {
    setup();
    const own = (await screen.findByText(SELF)).closest('li');
    const other = screen.getByText(OTHER).closest('li');
    expect(own).not.toBeNull();
    expect(within(own as HTMLElement).getByText('Você')).toBeInTheDocument();
    expect(within(other as HTMLElement).queryByText('Você')).toBeNull();
  });

  it('adds a developer by id and reloads', async () => {
    const { calls } = setup();
    await screen.findByText(OTHER);
    await userEvent.type(screen.getByLabelText('ID da pessoa'), NEW_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText(NEW_ID)).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'administration.developers.add')?.input).toEqual({
      userId: NEW_ID,
    });
  });

  it('puts focus back on the id field after adding', async () => {
    setup();
    await screen.findByText(OTHER);
    await userEvent.type(screen.getByLabelText('ID da pessoa'), NEW_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await screen.findByText(NEW_ID);
    expect(screen.getByLabelText('ID da pessoa')).toHaveFocus();
  });

  it('draws the list inside a panel so the rows keep their padding', async () => {
    setup();
    const list = (await screen.findByText(SELF)).closest('ul');
    expect(list?.parentElement).toHaveClass('panel');
    expect(list).not.toHaveClass('panel');
  });

  it('blocks an invalid id', async () => {
    setup();
    await screen.findByText(OTHER);
    await userEvent.type(screen.getByLabelText('ID da pessoa'), '12');
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeDisabled();
  });

  it('asks for confirmation before removing, then sends the id', async () => {
    const { calls } = setup();
    const row = (await screen.findByText(OTHER)).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Remover' }));
    expect(calls.some((call) => call.name === 'administration.developers.remove')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(screen.queryByText(OTHER)).toBeNull());
    expect(calls.find((call) => call.name === 'administration.developers.remove')?.input).toEqual({
      userId: OTHER,
    });
  });

  it('shows the server conflict when removing oneself', async () => {
    setup((call) =>
      call.name === 'administration.developers.remove'
        ? errorBody(409, 'conflict', SELF_CONFLICT)
        : undefined,
    );
    const row = (await screen.findByText(SELF)).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Remover' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    expect(await within(dialog).findByText(SELF_CONFLICT)).toBeInTheDocument();
  });

  it('shows "Sem permissão." on a 403', async () => {
    setup((call) =>
      call.name === 'administration.developers.list'
        ? errorBody(403, 'forbidden', 'Você não tem permissão para isso.')
        : undefined,
    );
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument();
  });
});

describe('developers screen: latest error', () => {
  it('clears a failed add when a removal starts', async () => {
    setup((call) =>
      call.name === 'administration.developers.add'
        ? errorBody(422, 'invalid', 'Pessoa inválida.')
        : undefined,
    );
    await screen.findByText(OTHER);
    await userEvent.type(screen.getByLabelText('ID da pessoa'), NEW_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Pessoa inválida.')).toBeInTheDocument();
    const row = screen.getByText(OTHER).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Remover' }));
    expect(screen.queryByText('Pessoa inválida.')).toBeNull();
  });
});
