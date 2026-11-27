import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate } from '../components/CaseDetail.tsx';
import { FakeClock, FakeWebSocket, lastSocket, stubWebSocket } from '../fake-websocket.ts';
import {
  errorBody,
  findToast,
  okBody,
  setupOperations,
  type OperationCall,
} from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const FAILED_AT = '2026-01-05T03:04:00.000Z';

function entry(overrides: Record<string, unknown>) {
  return {
    id: 'moderation',
    name: 'Moderação',
    description: '',
    version: '1.0.0',
    state: 'RUNNING',
    enabled: true,
    canDisable: true,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

function setup(
  modules: Record<string, unknown>[],
  override?: (call: OperationCall) => ReturnType<typeof okBody> | undefined,
) {
  const clock = new FakeClock();
  stubWebSocket();
  const operation = (call: OperationCall) => {
    const custom = override?.(call);
    if (custom !== undefined) return custom;
    if (call.name === 'administration.modules.list') return okBody({ modules });
    return okBody({ changed: true, module: modules[0] });
  };
  return { clock, ...setupOperations(['core.modules.manage'], operation, '/modulos', clock) };
}

const listCalls = (calls: OperationCall[]) =>
  calls.filter((call) => call.name === 'administration.modules.list').length;

describe('modules screen', () => {
  it('shows name, version, situation and dependencies of each module', async () => {
    setup([
      entry({}),
      entry({
        id: 'ping',
        name: 'Ping',
        version: '2.1.0',
        enabled: false,
        state: 'STOPPED',
        dependencies: ['moderation'],
      }),
    ]);
    const running = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    expect(within(running).getByText('Ligado')).toBeInTheDocument();
    expect(within(running).getByText(/1\.0\.0/)).toBeInTheDocument();
    const stopped = screen.getByText('Ping').closest('tr') as HTMLElement;
    expect(within(stopped).getByText('Desligado')).toBeInTheDocument();
    expect(within(stopped).getByText('Depende de: moderation')).toBeInTheDocument();
  });

  it('asks for confirmation before switching off, then sends the module and false', async () => {
    const { calls } = setup([entry({})]);
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch', { name: 'Moderação' }));
    expect(calls.some((call) => call.name === 'administration.modules.set-enabled')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desligar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((call) => call.name === 'administration.modules.set-enabled')?.input).toEqual(
      { moduleId: 'moderation', enabled: false },
    );
    await waitFor(() => expect(listCalls(calls)).toBe(2));
    expect(await findToast('Módulo desligado.')).toBeInTheDocument();
  });

  it('switches on without confirmation', async () => {
    const { calls } = setup([entry({ enabled: false, state: 'STOPPED' })]);
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch', { name: 'Moderação' }));
    await waitFor(() =>
      expect(
        calls.find((call) => call.name === 'administration.modules.set-enabled')?.input,
      ).toEqual({ moduleId: 'moderation', enabled: true }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await findToast('Módulo ligado.')).toBeInTheDocument();
  });

  it('shows the situation in a status badge with the tone of the state', async () => {
    setup([
      entry({}),
      entry({ id: 'ping', name: 'Ping', enabled: false, state: 'STOPPED' }),
      entry({ id: 'cases', name: 'Casos', state: 'FAILED' }),
      entry({ id: 'alarm', name: 'Alarme', state: 'STARTING' }),
    ]);
    const main = await screen.findByRole('main');
    const tone = async (text: string) =>
      (await within(main).findByText(text)).closest('[data-tone]')?.getAttribute('data-tone');
    expect(await tone('Ligado')).toBe('active');
    expect(await tone('Desligado')).toBe('inactive');
    expect(await tone('Falhou ao iniciar')).toBe('failed');
    expect(await tone('Em transição')).toBe('pending');
  });

  it('puts the search in the card header and filters the modules', async () => {
    setup([entry({}), entry({ id: 'ping', name: 'Ping' })]);
    await screen.findByText('Ping');
    const search = screen.getByLabelText('Buscar');
    expect(search.closest('[data-slot="card-header"]')).not.toBeNull();
    await userEvent.type(search, 'ping');
    expect(screen.getByRole('switch', { name: 'Ping' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Moderação' })).toBeNull();
  });

  it('draws the table inside a card so the rows keep their padding', async () => {
    setup([entry({})]);
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    expect(row.closest('[data-slot="card"]')).not.toBeNull();
  });

  it('shows a running module as a checked switch and a stopped one as unchecked', async () => {
    setup([entry({}), entry({ id: 'ping', name: 'Ping', enabled: false, state: 'STOPPED' })]);
    const running = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    expect(within(running).getByRole('switch', { name: 'Moderação' })).toBeChecked();
    const stopped = screen.getByText('Ping').closest('tr') as HTMLElement;
    expect(within(stopped).getByRole('switch', { name: 'Ping' })).not.toBeChecked();
  });

  it('moves focus to the heading when the Ligar button disappears', async () => {
    let running = false;
    const { calls } = setup([entry({})], (call) => {
      if (call.name === 'administration.modules.list') {
        return okBody({
          modules: [entry(running ? { canDisable: false } : { enabled: false, state: 'STOPPED' })],
        });
      }
      if (call.name === 'administration.modules.set-enabled') {
        running = true;
        return okBody({ changed: true });
      }
      return undefined;
    });
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch', { name: 'Moderação' }));
    await screen.findByText('Não pode ser desligado.');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Módulos', level: 1 })).toHaveFocus(),
    );
    expect(listCalls(calls)).toBe(2);
  });

  it('shows the server text of a 409 with dependents inside the dialog', async () => {
    const text = 'Outros módulos dependem deste: ping.';
    setup([entry({ dependents: ['ping'] })], (call) =>
      call.name === 'administration.modules.set-enabled'
        ? errorBody(409, 'conflict', text)
        : undefined,
    );
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch', { name: 'Moderação' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desligar' }));
    expect(await within(dialog).findByText(text)).toBeInTheDocument();
  });

  it('shows the server text of a failed enable and reloads the list', async () => {
    const text = 'O módulo não conseguiu iniciar.';
    const { calls } = setup([entry({ enabled: false, state: 'STOPPED' })], (call) =>
      call.name === 'administration.modules.set-enabled'
        ? errorBody(500, 'failed', text)
        : undefined,
    );
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch', { name: 'Moderação' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    await waitFor(() => expect(listCalls(calls)).toBe(2));
  });

  it('shows the server text of a 503', async () => {
    const text = 'O bot está encerrando.';
    setup([entry({ enabled: false, state: 'STOPPED' })], (call) =>
      call.name === 'administration.modules.set-enabled'
        ? errorBody(503, 'unavailable', text)
        : undefined,
    );
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch', { name: 'Moderação' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows FAILED with the time of the failure and offers Ligar', async () => {
    setup([entry({ state: 'FAILED', failedAt: FAILED_AT })]);
    const row = (await screen.findByText('Moderação')).closest('tr') as HTMLElement;
    expect(
      within(row).getByText(`Falhou ao iniciar (${formatDate(FAILED_AT)})`),
    ).toBeInTheDocument();
    expect(within(row).getByRole('switch', { name: 'Moderação' })).toBeInTheDocument();
  });

  it('shows "Em transição" for a module that is enabled but not running yet', async () => {
    setup([entry({ state: 'STOPPED' })]);
    expect(await screen.findByText('Em transição')).toBeInTheDocument();
  });

  it('shows no switch, only a note, for a running module that cannot be switched off', async () => {
    setup([entry({ id: 'administration', name: 'Administração', canDisable: false })]);
    // "Administração" is also a menu group, so look only at the screen.
    const main = await screen.findByRole('main');
    const row = (await within(main).findByText('Administração')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Não pode ser desligado.')).toBeInTheDocument();
    expect(within(row).queryByRole('switch')).toBeNull();
  });

  it('shows "Sem permissão." on a 403', async () => {
    setup([], (call) =>
      call.name === 'administration.modules.list'
        ? errorBody(403, 'forbidden', 'Você não tem permissão para isso.')
        : undefined,
    );
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument();
  });

  it('reloads the list when a live status arrives, at most once per window', async () => {
    const { calls, clock } = setup([entry({})]);
    await screen.findByText('Moderação');
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => {
      lastSocket().open();
    });
    const status = { connection: 'ready', uptimeMs: 1, modules: [] };
    const before = listCalls(calls);
    act(() => {
      lastSocket().receive('status', status);
    });
    await waitFor(() => expect(listCalls(calls)).toBe(before + 1));
    act(() => {
      lastSocket().receive('status', status);
      lastSocket().receive('status', status);
    });
    expect(listCalls(calls)).toBe(before + 1);
    act(() => {
      clock.advance(5_000);
    });
    await waitFor(() => expect(listCalls(calls)).toBe(before + 2));
  });
});
