import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate } from '../components/CaseDetail.tsx';
import { FakeClock } from '../fake-websocket.ts';
import { errorBody, okBody, setupOperations, type OperationCall } from '../test-utils.tsx';

afterEach(() => vi.unstubAllGlobals());

const TIME = '2026-01-05T03:04:00.000Z';

function setup(entries: unknown[], override?: (call: OperationCall) => ReturnType<typeof okBody>) {
  return setupOperations(
    ['core.logs.read'],
    (call) => override?.(call) ?? okBody({ entries }),
    '/logs',
    new FakeClock(),
  );
}

const logCalls = (calls: OperationCall[]) =>
  calls.filter((call) => call.name === 'administration.logs.recent');

describe('logs screen', () => {
  it('shows the entries with time, level as text, module, message and fields', async () => {
    const { calls } = setup([
      {
        time: TIME,
        level: 'warn',
        message: 'slow query',
        module: 'moderation',
        fields: { count: 3, ok: false, note: null, name: 'x' },
      },
      { time: TIME, level: 'error', message: 'boom', fields: {} },
    ]);
    const row = (await screen.findByText('slow query')).closest('tr') as HTMLElement;
    expect(within(row).getByText(formatDate(TIME))).toBeInTheDocument();
    expect(within(row).getByText('Aviso')).toBeInTheDocument();
    expect(within(row).getByText('moderation')).toBeInTheDocument();
    expect(within(row).getByText('count: 3, ok: false, note: null, name: x')).toBeInTheDocument();
    const second = screen.getByText('boom').closest('tr') as HTMLElement;
    expect(within(second).getByText('Erro')).toBeInTheDocument();
    expect(within(second).getByText('—')).toBeInTheDocument();
    expect(logCalls(calls)[0]?.input).toEqual({ limit: 200, minLevel: 'info' });
  });

  it('sends minLevel when the filter changes', async () => {
    const { calls } = setup([{ time: TIME, level: 'error', message: 'boom', fields: {} }]);
    await screen.findByText('boom');
    await userEvent.selectOptions(screen.getByLabelText('Nível mínimo'), 'error');
    await waitFor(() => expect(logCalls(calls)).toHaveLength(2));
    expect(logCalls(calls)[1]?.input).toEqual({ limit: 200, minLevel: 'error' });
  });

  it('keeps the previous rows on screen while a new filter loads', async () => {
    setup([{ time: TIME, level: 'error', message: 'boom', fields: {} }]);
    await screen.findByText('boom');
    const original = globalThis.fetch;
    let release: () => void = () => undefined;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.startsWith('/api/operations/') && (init?.body as string).includes('"fatal"')
        ? new Promise<Response>((resolve) => {
            release = () => {
              resolve(original(url, init));
            };
          })
        : original(url, init),
    );
    await userEvent.selectOptions(screen.getByLabelText('Nível mínimo'), 'fatal');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled());
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('Carregando…')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled());
  });

  it('fetches again with Atualizar', async () => {
    const { calls } = setup([{ time: TIME, level: 'info', message: 'hello', fields: {} }]);
    await screen.findByText('hello');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(logCalls(calls)).toHaveLength(2));
  });

  it('shows HTML in a message as text', async () => {
    const html = '<img src=x onerror=alert(1)><b>bold</b>';
    setup([{ time: TIME, level: 'info', message: html, fields: { tag: '<script>1</script>' } }]);
    expect(await screen.findByText(html)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('tag: <script>1</script>')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    setup([]);
    expect(await screen.findByText('Nenhum registro.')).toBeInTheDocument();
  });

  it('shows "Sem permissão." on a 403', async () => {
    setup([], () => errorBody(403, 'forbidden', 'Você não tem permissão para isso.'));
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument();
  });
});
