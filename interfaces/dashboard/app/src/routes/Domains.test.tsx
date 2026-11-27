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

function setup(
  allow: string[] = ['good.example.com'],
  override?: (call: OperationCall) => ReturnType<typeof okBody> | undefined,
) {
  const lists: Record<string, string[]> = {
    block: ['bad.example.com'],
    allow,
  };
  const operation = (call: OperationCall) => {
    const custom = override?.(call);
    if (custom !== undefined) return custom;
    const domain = String(call.input['domain']);
    if (call.name === 'moderation.domains.list') {
      const list = String(call.input['list']);
      return okBody({ list, domains: lists[list] });
    }
    if (call.name === 'moderation.domains.block') {
      lists['block'] = [...(lists['block'] ?? []), domain];
      return okBody({ domain, list: 'block' });
    }
    if (call.name === 'moderation.domains.remove') {
      lists['allow'] = (lists['allow'] ?? []).filter((item) => item !== domain);
      return okBody({ domain });
    }
    return okBody(null);
  };
  return setupOperations(['moderation.domains.manage'], operation, '/dominios', new FakeClock());
}

describe('domains screen', () => {
  it('shows the blocked and allowed lists', async () => {
    setup();
    const blocked = await screen.findByRole('region', { name: 'Bloqueados' });
    const allowed = screen.getByRole('region', { name: 'Permitidos' });
    expect(await within(blocked).findByText('bad.example.com')).toBeInTheDocument();
    expect(await within(allowed).findByText('good.example.com')).toBeInTheDocument();
  });

  it('adds a domain to the blocked list from the dialog and shows it', async () => {
    const { calls } = setup();
    const blocked = await screen.findByRole('region', { name: 'Bloqueados' });
    const trigger = within(blocked).getByRole('button', { name: 'Adicionar' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Adicionar domínio bloqueado' });
    await userEvent.type(within(dialog).getByLabelText('Domínio'), 'new.example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    expect(await within(blocked).findByText('new.example.com')).toBeInTheDocument();
    expect(await findToast('Domínio adicionado.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(calls.find((call) => call.name === 'moderation.domains.block')?.input).toEqual({
      domain: 'new.example.com',
    });
  });

  it('opens an empty field after a successful add', async () => {
    setup();
    const blocked = await screen.findByRole('region', { name: 'Bloqueados' });
    const trigger = within(blocked).getByRole('button', { name: 'Adicionar' });
    await userEvent.click(trigger);
    await userEvent.type(screen.getByLabelText('Domínio'), 'new.example.com');
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Adicionar' }),
    );
    await within(blocked).findByText('new.example.com');
    await userEvent.click(trigger);
    expect(screen.getByLabelText('Domínio')).toHaveValue('');
  });

  it('names the allowed list dialog', async () => {
    setup();
    const allowed = await screen.findByRole('region', { name: 'Permitidos' });
    await userEvent.click(within(allowed).getByRole('button', { name: 'Adicionar' }));
    expect(screen.getByRole('dialog', { name: 'Adicionar domínio permitido' })).toBeInTheDocument();
  });

  it('keeps the dialog open with the error on a 409', async () => {
    setup(undefined, (call) =>
      call.name === 'moderation.domains.block'
        ? errorBody(409, 'conflict', 'Domínio já está na outra lista.')
        : undefined,
    );
    const blocked = await screen.findByRole('region', { name: 'Bloqueados' });
    await userEvent.click(within(blocked).getByRole('button', { name: 'Adicionar' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Domínio'), 'good.example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Domínio já está na outra lista.',
    );
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByLabelText('Domínio')).toHaveValue('good.example.com');
    expect(noToast()).toBe(true);
  });

  it('closes the dialog on Escape without sending', async () => {
    const { calls } = setup();
    const blocked = await screen.findByRole('region', { name: 'Bloqueados' });
    const trigger = within(blocked).getByRole('button', { name: 'Adicionar' });
    await userEvent.click(trigger);
    await userEvent.type(screen.getByLabelText('Domínio'), 'new.example.com');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(calls.some((call) => call.name === 'moderation.domains.block')).toBe(false);
    expect(noToast()).toBe(true);
  });

  it('shows an empty list with the empty state', async () => {
    setup([]);
    const allowed = await screen.findByRole('region', { name: 'Permitidos' });
    const empty = await within(allowed).findByText('Nenhum domínio nesta lista.');
    expect(empty.closest('.border-dashed')).not.toBeNull();
  });

  it('removes a domain', async () => {
    const { calls } = setup();
    const allowed = await screen.findByRole('region', { name: 'Permitidos' });
    await within(allowed).findByText('good.example.com');
    const remove = within(allowed).getByRole('button', { name: 'Remover' });
    expect(remove).toHaveAccessibleDescription('good.example.com');
    expect(remove).toHaveClass('text-destructive');
    await userEvent.click(remove);
    await waitFor(() => expect(within(allowed).queryByText('good.example.com')).toBeNull());
    expect(await findToast('Domínio removido.')).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'moderation.domains.remove')?.input).toEqual({
      domain: 'good.example.com',
    });
  });

  it('does not hand the focused Remover to the next domain after a removal', async () => {
    setup(['first.example.com', 'second.example.com']);
    const allowed = await screen.findByRole('region', { name: 'Permitidos' });
    await within(allowed).findByText('first.example.com');
    const first = within(allowed).getAllByRole('button', { name: 'Remover' })[0]!;
    first.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(within(allowed).queryByText('first.example.com')).toBeNull());
    const second = within(allowed).getByRole('button', { name: 'Remover' });
    expect(within(allowed).getByText('second.example.com')).toBeInTheDocument();
    expect(first).not.toBeInTheDocument();
    expect(second).not.toHaveFocus();
  });
});
