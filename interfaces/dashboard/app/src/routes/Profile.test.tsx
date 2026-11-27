import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../fake-websocket.ts';
import { okBody, setupOperations, type OperationCall } from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

function setup(permissions: string[], cases: unknown[] = [], path = '/') {
  return setupOperations(
    permissions,
    (call: OperationCall) =>
      call.name === 'moderation.cases.mine' ? okBody({ cases }) : okBody(null),
    path,
    new FakeClock(),
  );
}

describe('my cases', () => {
  it('lists the person cases with date, type, action and status', async () => {
    const { calls } = setup(
      [],
      [
        {
          id: 7,
          createdAt: '2026-11-20T10:00:00.000Z',
          kind: 'manual',
          action: 'warn',
          status: 'actioned',
        },
      ],
    );
    expect(await screen.findByRole('heading', { name: 'Meus casos' })).toBeInTheDocument();
    const row = await within(screen.getByRole('main')).findByRole('listitem');
    expect(row).toHaveTextContent('Manual');
    expect(row).toHaveTextContent('Aviso');
    expect(row).toHaveTextContent('Com ação aplicada');
    expect(calls[0]).toEqual({ name: 'moderation.cases.mine', input: {} });
  });

  it('says so when there are none', async () => {
    setup([]);
    expect(await screen.findByText('Nenhum caso registrado com você.')).toBeInTheDocument();
  });
});

describe('menu by permission', () => {
  it('hides the moderation items without permission', async () => {
    setup([]);
    await screen.findByRole('heading', { level: 1, name: 'Meu perfil' });
    for (const name of ['Ações', 'Domínios', 'Configuração']) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
  });

  it('shows Ações with any moderation.actions.*', async () => {
    setup(['moderation.actions.kick']);
    expect(await screen.findByRole('link', { name: 'Ações' })).toHaveAttribute('href', '/acoes');
  });

  it('shows Domínios and Configuração with their permissions', async () => {
    setup(['moderation.domains.manage', 'moderation.config.manage']);
    expect(await screen.findByRole('link', { name: 'Domínios' })).toHaveAttribute(
      'href',
      '/dominios',
    );
    expect(screen.getByRole('link', { name: 'Configuração' })).toHaveAttribute(
      'href',
      '/moderacao',
    );
  });
});
