import { screen, within } from '@testing-library/react';
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

const ROLE_A = '222222222222222222';
const ROLE_B = '333333333333333333';

function setup(override?: (call: OperationCall) => ReturnType<typeof okBody> | undefined) {
  const grants = [
    { permission: 'moderation.cases.read', roleId: ROLE_A, grantedAt: '2026-01-02T03:04:00.000Z' },
  ];
  const operation = (call: OperationCall) => {
    const custom = override?.(call);
    if (custom !== undefined) return custom;
    if (call.name === 'administration.grants.list') {
      return okBody({
        grants,
        grantable: ['moderation.cases.read', 'moderation.config.manage'],
      });
    }
    if (call.name === 'administration.grants.grant') {
      grants.push({
        permission: String(call.input['permission']),
        roleId: String(call.input['roleId']),
        grantedAt: '2026-01-03T03:04:00.000Z',
      });
      return okBody({ granted: true });
    }
    if (call.name === 'administration.grants.revoke') {
      grants.splice(0, grants.length);
      return okBody({ revoked: true });
    }
    return okBody(null);
  };
  return setupOperations(
    ['administration.grants.manage'],
    operation,
    '/permissoes',
    new FakeClock(),
  );
}

async function openGrant(): Promise<{ trigger: HTMLElement; dialog: HTMLElement }> {
  const trigger = screen.getByRole('button', { name: 'Associar permissão' });
  await userEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Associar permissão' }) };
}

describe('grants screen', () => {
  it('lists the roles grouped by permission', async () => {
    setup();
    const group = await screen.findByRole('region', { name: 'moderation.cases.read' });
    expect(within(group).getByText(ROLE_A)).toBeInTheDocument();
  });

  it('grants a permission from the dialog and reloads the list', async () => {
    const { calls } = setup();
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    const { dialog } = await openGrant();
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Permissão'),
      'moderation.config.manage',
    );
    await userEvent.type(within(dialog).getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Associar' }));
    const group = await screen.findByRole('region', { name: 'moderation.config.manage' });
    expect(within(group).getByText(ROLE_B)).toBeInTheDocument();
    expect(await findToast('Permissão concedida.')).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'administration.grants.grant')?.input).toEqual({
      permission: 'moderation.config.manage',
      roleId: ROLE_B,
    });
  });

  it('offers the grantable permissions in the dialog', async () => {
    setup();
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    const { dialog } = await openGrant();
    const options = within(within(dialog).getByLabelText('Permissão')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'moderation.cases.read',
      'moderation.config.manage',
    ]);
  });

  it('closes the dialog and puts focus back on its trigger after granting', async () => {
    setup();
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    const { trigger, dialog } = await openGrant();
    await userEvent.type(within(dialog).getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Associar' }));
    await screen.findByText(ROLE_B);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    expect(screen.getByLabelText('ID do cargo')).toHaveValue('');
  });

  it('blocks an invalid role id', async () => {
    const { calls } = setup();
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    const { dialog } = await openGrant();
    await userEvent.type(within(dialog).getByLabelText('ID do cargo'), '123');
    expect(within(dialog).getByRole('button', { name: 'Associar' })).toBeDisabled();
    expect(calls.some((call) => call.name === 'administration.grants.grant')).toBe(false);
  });

  it('keeps the dialog open with the server error on a 422', async () => {
    setup((call) =>
      call.name === 'administration.grants.grant'
        ? errorBody(422, 'invalid', 'Esta permissão não pode ser associada a cargos.')
        : undefined,
    );
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    const { dialog } = await openGrant();
    await userEvent.type(within(dialog).getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Associar' }));
    const message = await within(dialog).findByText(
      'Esta permissão não pode ser associada a cargos.',
    );
    expect(message).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(noToast()).toBe(true);
  });

  it('closes the dialog on Escape without sending', async () => {
    const { calls } = setup();
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    const { trigger, dialog } = await openGrant();
    await userEvent.type(within(dialog).getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(calls.some((call) => call.name === 'administration.grants.grant')).toBe(false);
  });

  it('revokes a grant without confirmation and reloads', async () => {
    const { calls } = setup();
    const group = await screen.findByRole('region', { name: 'moderation.cases.read' });
    const remove = within(group).getByRole('button', { name: 'Remover' });
    expect(remove).toHaveClass('text-destructive');
    await userEvent.click(remove);
    const empty = await screen.findByText('Nenhuma permissão associada a cargos.');
    expect(empty.closest('.border-dashed')).not.toBeNull();
    expect(await findToast('Permissão removida.')).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'administration.grants.revoke')?.input).toEqual({
      permission: 'moderation.cases.read',
      roleId: ROLE_A,
    });
  });

  it('shows "Sem permissão." on a 403', async () => {
    setup((call) =>
      call.name === 'administration.grants.list'
        ? errorBody(403, 'forbidden', 'Você não tem permissão para isso.')
        : undefined,
    );
    const message = await screen.findByText('Sem permissão.');
    expect(message.closest('[data-slot="alert"]')).toHaveAttribute('role', 'alert');
  });
});

describe('grants screen: latest error and focus', () => {
  it('shows only the error of the latest mutation', async () => {
    setup((call) => {
      if (call.name === 'administration.grants.grant') {
        return errorBody(422, 'invalid', 'Permissão inválida.');
      }
      if (call.name === 'administration.grants.revoke') {
        return errorBody(500, 'failed', 'Falha ao remover.');
      }
      return undefined;
    });
    const group = await screen.findByRole('region', { name: 'moderation.cases.read' });
    const { trigger, dialog } = await openGrant();
    await userEvent.type(within(dialog).getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Associar' }));
    expect(await screen.findByText('Permissão inválida.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }));
    expect(await screen.findByText('Falha ao remover.')).toBeInTheDocument();
    expect(screen.queryByText('Permissão inválida.')).toBeNull();
    await userEvent.click(trigger);
    expect(screen.queryByText('Permissão inválida.')).toBeNull();
  });

  it('moves focus to the grant button after a revoke', async () => {
    setup();
    const group = await screen.findByRole('region', { name: 'moderation.cases.read' });
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }));
    await screen.findByText('Nenhuma permissão associada a cargos.');
    expect(screen.getByRole('button', { name: 'Associar permissão' })).toHaveFocus();
  });
});
