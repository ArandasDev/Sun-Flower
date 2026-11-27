import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../fake-websocket.ts';
import {
  errorBody,
  findToast,
  me,
  noToast,
  okBody,
  renderApp,
  setupOperations,
  stubFetch,
} from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const TARGET = '222222222222222222';
const unauthorized = errorBody(401, 'unauthorized', 'x');
const ALL = [
  'moderation.actions.warn',
  'moderation.actions.timeout',
  'moderation.actions.kick',
  'moderation.actions.ban',
];

function answer() {
  return okBody({ caseId: 9 });
}

function setup(permissions = ALL, operation = answer) {
  return setupOperations(permissions, operation, '/acoes', new FakeClock());
}

/** The result text also appears in a toast, so the screen's own copy is looked up inside <main>. */
function inScreen(text: string) {
  return within(screen.getByRole('main')).findByText(text);
}

async function fill(reason = 'Motivo de teste') {
  await userEvent.type(await screen.findByLabelText('ID do usuário'), TARGET);
  await userEvent.type(screen.getByLabelText('Motivo'), reason);
}

describe('actions screen', () => {
  it('shows one tab per action the person holds', async () => {
    setup(['moderation.actions.warn', 'moderation.actions.ban']);
    await screen.findByRole('tablist');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Avisar', 'Banir']);
  });

  it('shows no-permission text without any action permission', async () => {
    setup([]);
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument();
  });

  it('sends a warning and reports the case', async () => {
    const { calls } = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }));
    expect(await inScreen('Caso #9 registrado.')).toBeInTheDocument();
    expect(await findToast('Caso #9 registrado.')).toBeInTheDocument();
    expect(calls).toEqual([
      { name: 'moderation.actions.warn', input: { userId: TARGET, reason: 'Motivo de teste' } },
    ]);
  });

  it('moves focus to the result after a send', async () => {
    setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }));
    const status = await inScreen('Caso #9 registrado.');
    await waitFor(() => expect(status.parentElement).toHaveFocus());
  });

  it('mentions a failed direct message', async () => {
    setup(ALL, () => okBody({ caseId: 3, dmFailed: true }));
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }));
    expect(await inScreen('Caso #3 registrado.')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível enviar mensagem direta.')).toBeInTheDocument();
  });

  it('sends the timeout minutes', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('tab', { name: 'Silenciar' }));
    await fill();
    await userEvent.clear(screen.getByLabelText('Minutos'));
    await userEvent.type(screen.getByLabelText('Minutos'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar silêncio' }));
    await inScreen('Caso #9 registrado.');
    expect(calls[0]).toEqual({
      name: 'moderation.actions.timeout',
      input: { userId: TARGET, reason: 'Motivo de teste', minutes: 30 },
    });
  });

  it('asks for confirmation before a ban and sends the right input', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('tab', { name: 'Banir' }));
    await fill();
    await userEvent.type(screen.getByLabelText('Dias de mensagens a apagar'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Banir membro' }));
    expect(calls).toHaveLength(0);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Banir' }));
    expect(await inScreen('Caso #9 registrado.')).toBeInTheDocument();
    expect(calls).toEqual([
      {
        name: 'moderation.actions.ban',
        input: { userId: TARGET, reason: 'Motivo de teste', deleteDays: 3 },
      },
    ]);
  });

  it('does not send a kick when the confirmation is cancelled', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('tab', { name: 'Expulsar' }));
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Expulsar membro' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(calls).toHaveLength(0);
  });

  it('blocks the send on an invalid user id', async () => {
    const { calls } = setup();
    await userEvent.type(await screen.findByLabelText('ID do usuário'), '123');
    await userEvent.type(screen.getByLabelText('Motivo'), 'x');
    expect(screen.getByText('Use de 17 a 20 dígitos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar aviso' })).toBeDisabled();
    expect(calls).toHaveLength(0);
  });

  it('shows "Sem permissão." when the Core refuses the permission', async () => {
    setup(ALL, () => errorBody(403, 'forbidden', 'Você não tem permissão para isso.'));
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }));
    await waitFor(() =>
      expect(within(screen.getByRole('tabpanel')).getByRole('alert')).toHaveTextContent(
        'Sem permissão.',
      ),
    );
    expect(noToast()).toBe(true);
  });

  it('goes to the login when an action answers 401', async () => {
    let signedIn = true;
    stubFetch((url) => {
      if (url === '/api/me') return signedIn ? me('staff', { permissions: ALL }) : unauthorized;
      signedIn = false;
      return unauthorized;
    });
    renderApp('/acoes', new FakeClock());
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }));
    expect(await screen.findByRole('link', { name: 'Entrar com Discord' })).toBeInTheDocument();
  });

  it('shows the server error', async () => {
    setup(ALL, () => errorBody(403, 'forbidden', 'Você não pode moderar este membro.'));
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar aviso' }));
    await waitFor(() =>
      expect(within(screen.getByRole('tabpanel')).getByRole('alert')).toHaveTextContent(
        'Você não pode moderar este membro.',
      ),
    );
  });
});
