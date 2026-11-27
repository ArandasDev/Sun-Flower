import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from './components/Toaster.tsx';
import { notify } from './toast.ts';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

/** The visible toasts with this text (the title lives in the toast, apart from Radix's live region). */
const toasts = (text: string) =>
  screen.queryAllByText(text, { selector: '[data-slot="toast-title"]' });

describe('toaster', () => {
  it('shows a message sent with notify, in a labelled region', async () => {
    render(<Toaster />);
    act(() => notify('Domínio adicionado.'));
    expect(await screen.findByText('Domínio adicionado.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Notificações/ })).toContainElement(
      toasts('Domínio adicionado.')[0]!,
    );
  });

  it('announces the message to screen readers through a status region', async () => {
    render(<Toaster />);
    act(() => notify('Sessão revogada.'));
    await vi.waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((node) => node.textContent?.includes('Sessão revogada.')),
      ).toBe(true),
    );
  });

  it('closes with the Fechar button', async () => {
    render(<Toaster />);
    act(() => notify('Sessão revogada.'));
    await screen.findByText('Sessão revogada.');
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await vi.waitFor(() => expect(toasts('Sessão revogada.')).toHaveLength(0));
  });

  it('goes away by itself after 4 seconds', async () => {
    render(<Toaster />);
    act(() => notify('Módulo ligado.'));
    await screen.findByText('Módulo ligado.');
    act(() => {
      vi.advanceTimersByTime(3900);
    });
    expect(toasts('Módulo ligado.')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    await vi.waitFor(() => expect(toasts('Módulo ligado.')).toHaveLength(0));
  });
});
