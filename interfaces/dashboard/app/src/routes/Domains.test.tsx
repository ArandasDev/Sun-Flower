import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../fake-websocket.ts';
import { findToast, okBody, setupOperations, type OperationCall } from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const lists: Record<string, string[]> = {
    block: ['bad.example.com'],
    allow: ['good.example.com'],
  };
  const operation = (call: OperationCall) => {
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

  it('adds a domain to the blocked list and shows it', async () => {
    const { calls } = setup();
    const blocked = await screen.findByRole('region', { name: 'Bloqueados' });
    await userEvent.type(within(blocked).getByLabelText('Adicionar domínio'), 'new.example.com');
    await userEvent.click(within(blocked).getByRole('button', { name: 'Adicionar' }));
    expect(await within(blocked).findByText('new.example.com')).toBeInTheDocument();
    expect(await findToast('Domínio adicionado.')).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'moderation.domains.block')?.input).toEqual({
      domain: 'new.example.com',
    });
  });

  it('removes a domain', async () => {
    const { calls } = setup();
    const allowed = await screen.findByRole('region', { name: 'Permitidos' });
    await within(allowed).findByText('good.example.com');
    await userEvent.click(within(allowed).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(within(allowed).queryByText('good.example.com')).toBeNull());
    expect(await findToast('Domínio removido.')).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'moderation.domains.remove')?.input).toEqual({
      domain: 'good.example.com',
    });
  });
});
