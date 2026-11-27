import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, lastSocket } from '../fake-websocket.ts';
import {
  errorBody,
  findToast,
  noToast,
  okBody,
  setupOperations,
  type FakeResponse,
  type OperationCall,
} from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const CONFLICT = 'Outra pessoa alterou esta configuração. Recarregue para ver a versão atual.';
const CHANNEL = '444444444444444444';

function makeConfig(timeoutMinutes = 60) {
  const rule = {
    enabled: true,
    limit: 7,
    seconds: 5,
    deleteMinutes: 2,
    punishment: 'timeout',
    timeoutMinutes: 10,
  };
  return {
    alertChannelId: CHANNEL,
    timeoutMinutes,
    thresholds: { confirmed: 80, suspicious: 40 },
    weights: {
      blocked: 100,
      lookalike: 60,
      masked: 40,
      multiChannel: 50,
      bait: 30,
      massMention: 20,
      newAccount: 15,
    },
    exemptRoleIds: [],
    newAccountDays: 7,
    newMemberHours: 24,
    multiChannel: { channels: 3, windowSeconds: 60 },
    baitTerms: ['nitro'],
    spam: {
      ignoredChannelIds: [],
      flood: rule,
      repeat: { ...rule, seconds: 60 },
      mentions: {
        enabled: true,
        limit: 6,
        deleteMinutes: 0,
        punishment: 'timeout',
        timeoutMinutes: 10,
      },
      escalation: { enabled: true, windowHours: 24, steps: [{ kind: 'timeout', minutes: 10 }] },
    },
  };
}

function setup(update?: (call: OperationCall, state: { version: number }) => FakeResponse) {
  const state = { version: 1, config: makeConfig() };
  const clock = new FakeClock();
  const operation = (call: OperationCall): FakeResponse => {
    if (call.name === 'moderation.config.view') {
      return okBody({ version: state.version, config: state.config });
    }
    if (call.name === 'moderation.config.update') {
      if (update !== undefined) return update(call, state);
      state.version += 1;
      state.config = { ...state.config, ...(call.input['changes'] as object) };
      return okBody({ version: state.version, config: state.config });
    }
    return okBody(null);
  };
  const view = setupOperations(['moderation.config.manage'], operation, '/moderacao', clock);
  return { ...view, state };
}

const section = (name: string) => screen.getByRole('region', { name });

async function timeoutField() {
  await screen.findByRole('heading', { level: 1, name: 'Moderação' });
  return within(await screen.findByRole('region', { name: 'Silenciamento' })).getByLabelText(
    'Minutos de silêncio padrão',
  );
}

describe('moderation settings', () => {
  it('saves only the keys of its section with the loaded version', async () => {
    const { calls } = setup();
    const field = await timeoutField();
    await userEvent.clear(field);
    await userEvent.type(field, '90');
    await userEvent.click(within(section('Silenciamento')).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(calls.find((call) => call.name === 'moderation.config.update')).toBeDefined(),
    );
    expect(calls.find((call) => call.name === 'moderation.config.update')?.input).toEqual({
      expectedVersion: 1,
      changes: { timeoutMinutes: 90 },
    });
    expect(await findToast('Configuração salva.')).toBeInTheDocument();
  });

  it('keeps Salvar disabled while the section has no unsaved changes', async () => {
    const { calls } = setup();
    const field = await timeoutField();
    const button = within(section('Silenciamento')).getByRole('button', { name: 'Salvar' });
    expect(button).toBeDisabled();
    await userEvent.type(field, '1');
    expect(button).toBeEnabled();
    await userEvent.type(field, '{Backspace}');
    expect(button).toBeDisabled();
    expect(calls.some((call) => call.name === 'moderation.config.update')).toBe(false);
  });

  it('marks a section with unsaved changes in text', async () => {
    setup();
    const field = await timeoutField();
    expect(within(section('Silenciamento')).queryByText('Alterações não salvas.')).toBeNull();
    await userEvent.type(field, '1');
    expect(
      within(section('Silenciamento')).getByText('Alterações não salvas.'),
    ).toBeInTheDocument();
    expect(within(section('Alertas')).queryByText('Alterações não salvas.')).toBeNull();
  });

  it('uses the returned version for the next save', async () => {
    const { calls } = setup();
    const field = await timeoutField();
    await userEvent.type(field, '0');
    await userEvent.click(within(section('Silenciamento')).getByRole('button', { name: 'Salvar' }));
    await within(section('Silenciamento')).findByText('Salvo.');
    await userEvent.type(field, '0');
    await userEvent.click(within(section('Silenciamento')).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(calls.filter((call) => call.name === 'moderation.config.update')).toHaveLength(2),
    );
    const updates = calls.filter((call) => call.name === 'moderation.config.update');
    expect(updates[1]?.input['expectedVersion']).toBe(2);
  });

  it('keeps the alert channel out of the save when the field is empty', async () => {
    const { calls } = setup();
    await screen.findByRole('heading', { level: 1, name: 'Moderação' });
    const alerts = await screen.findByRole('region', { name: 'Alertas' });
    expect(within(alerts).getByText('Deixe em branco para manter o canal atual.')).toBeVisible();
    const field = within(alerts).getByLabelText('ID do canal de alertas');
    expect(field).toHaveValue(CHANNEL);
    await userEvent.clear(field);
    expect(within(alerts).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(calls.some((call) => call.name === 'moderation.config.update')).toBe(false);
  });

  it('sends the whole spam key with only the rule changed', async () => {
    const { calls, state } = setup();
    await screen.findByRole('heading', { level: 1, name: 'Moderação' });
    const flood = await screen.findByRole('region', { name: 'Excesso de mensagens' });
    const limit = within(flood).getByLabelText('Limite de mensagens');
    await userEvent.clear(limit);
    await userEvent.type(limit, '9');
    await userEvent.click(within(flood).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(calls.find((call) => call.name === 'moderation.config.update')).toBeDefined(),
    );
    const input = calls.find((call) => call.name === 'moderation.config.update')?.input as {
      changes: { spam: { flood: { limit: number }; repeat: unknown } };
    };
    expect(Object.keys(input.changes)).toEqual(['spam']);
    expect(input.changes.spam.flood.limit).toBe(9);
    expect(input.changes.spam.repeat).toEqual(state.config.spam.repeat);
  });

  it('blocks a save with an out-of-range value', async () => {
    const { calls } = setup();
    const field = await timeoutField();
    await userEvent.clear(field);
    await userEvent.type(field, '99999');
    expect(within(section('Silenciamento')).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(calls.some((call) => call.name === 'moderation.config.update')).toBe(false);
  });

  it('shows the conflict on a 409 and keeps what was typed, then reloads', async () => {
    const { state } = setup(() => errorBody(409, 'conflict', CONFLICT));
    const field = await timeoutField();
    await userEvent.clear(field);
    await userEvent.type(field, '90');
    state.version = 5;
    state.config = makeConfig(120);
    await userEvent.click(within(section('Silenciamento')).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(CONFLICT)).toBeInTheDocument();
    expect(noToast()).toBe(true);
    expect(field).toHaveValue('90');
    await userEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
    await waitFor(() => expect(field).toHaveValue('120'));
    expect(screen.queryByText(CONFLICT)).toBeNull();
  });

  it('shows the 422 message in the section and keeps the values', async () => {
    setup(() => errorBody(422, 'invalid', 'Entrada inválida: thresholds.'));
    const field = await timeoutField();
    await userEvent.type(field, '1');
    await userEvent.click(within(section('Silenciamento')).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(section('Silenciamento')).findByText('Entrada inválida: thresholds.'),
    ).toBeInTheDocument();
    expect(field).toHaveValue('601');
  });

  it('refetches on config.changed from someone else when there are no edits', async () => {
    const { state } = setup();
    const field = await timeoutField();
    expect(field).toHaveValue('60');
    state.version = 2;
    state.config = makeConfig(75);
    act(() => {
      lastSocket().receive('config.changed', { moduleId: 'moderation', version: 2 });
    });
    await waitFor(() => expect(field).toHaveValue('75'));
    expect(screen.queryByText(CONFLICT)).toBeNull();
  });

  it('shows the conflict on config.changed from someone else when there are edits', async () => {
    const { state } = setup();
    const field = await timeoutField();
    await userEvent.type(field, '5');
    state.version = 2;
    state.config = makeConfig(75);
    act(() => {
      lastSocket().receive('config.changed', { moduleId: 'moderation', version: 2 });
    });
    expect(await screen.findByText(CONFLICT)).toBeInTheDocument();
    expect(field).toHaveValue('605');
  });

  it('does not show the conflict for the echo of its own save', async () => {
    const { state } = setup();
    const field = await timeoutField();
    await userEvent.type(field, '5');
    await userEvent.click(within(section('Silenciamento')).getByRole('button', { name: 'Salvar' }));
    await within(section('Silenciamento')).findByText('Salvo.');
    await userEvent.type(field, '1');
    act(() => {
      lastSocket().receive('config.changed', { moduleId: 'moderation', version: state.version });
    });
    await act(() => Promise.resolve());
    expect(screen.queryByText(CONFLICT)).toBeNull();
    expect(field).toHaveValue('6051');
  });
});
