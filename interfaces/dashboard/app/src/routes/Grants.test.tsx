import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../fake-websocket.ts';
import { errorBody, okBody, setupOperations, type OperationCall } from '../test-utils.tsx';

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

describe('grants screen', () => {
  it('lists the roles grouped by permission', async () => {
    setup();
    const group = await screen.findByRole('region', { name: 'moderation.cases.read' });
    expect(within(group).getByText(ROLE_A)).toBeInTheDocument();
  });

  it('grants a permission and reloads the list', async () => {
    const { calls } = setup();
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    await userEvent.selectOptions(screen.getByLabelText('Permissão'), 'moderation.config.manage');
    await userEvent.type(screen.getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.click(screen.getByRole('button', { name: 'Associar' }));
    const group = await screen.findByRole('region', { name: 'moderation.config.manage' });
    expect(within(group).getByText(ROLE_B)).toBeInTheDocument();
    expect(calls.find((call) => call.name === 'administration.grants.grant')?.input).toEqual({
      permission: 'moderation.config.manage',
      roleId: ROLE_B,
    });
  });

  it('blocks an invalid role id', async () => {
    const { calls } = setup();
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    await userEvent.type(screen.getByLabelText('ID do cargo'), '123');
    expect(screen.getByRole('button', { name: 'Associar' })).toBeDisabled();
    expect(calls.some((call) => call.name === 'administration.grants.grant')).toBe(false);
  });

  it('shows the server error in the form', async () => {
    setup((call) =>
      call.name === 'administration.grants.grant'
        ? errorBody(422, 'invalid', 'Esta permissão não pode ser associada a cargos.')
        : undefined,
    );
    await screen.findByRole('region', { name: 'moderation.cases.read' });
    await userEvent.type(screen.getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.click(screen.getByRole('button', { name: 'Associar' }));
    const message = await screen.findByText('Esta permissão não pode ser associada a cargos.');
    expect(message).toHaveAttribute('role', 'alert');
  });

  it('revokes a grant without confirmation and reloads', async () => {
    const { calls } = setup();
    const group = await screen.findByRole('region', { name: 'moderation.cases.read' });
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }));
    expect(await screen.findByText('Nenhuma permissão associada a cargos.')).toBeInTheDocument();
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
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument();
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
    await userEvent.type(screen.getByLabelText('ID do cargo'), ROLE_B);
    await userEvent.click(screen.getByRole('button', { name: 'Associar' }));
    expect(await screen.findByText('Permissão inválida.')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }));
    expect(await screen.findByText('Falha ao remover.')).toBeInTheDocument();
    expect(screen.queryByText('Permissão inválida.')).toBeNull();
  });

  it('moves focus to the permission select after a revoke', async () => {
    setup();
    const group = await screen.findByRole('region', { name: 'moderation.cases.read' });
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }));
    await screen.findByText('Nenhuma permissão associada a cargos.');
    expect(screen.getByLabelText('Permissão')).toHaveFocus();
  });
});
