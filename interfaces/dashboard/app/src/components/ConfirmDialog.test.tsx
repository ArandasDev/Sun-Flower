import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface HarnessProps {
  pending?: boolean;
  error?: string | null;
  onConfirm?: () => void;
  onCancel?: () => void;
  useReturnFocus?: boolean;
}

/** An opener button that shows the dialog, as the screens do: mounted while open. */
function Harness({
  pending = false,
  error = null,
  onConfirm = () => {},
  onCancel = () => {},
  useReturnFocus = false,
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  const returnRef = useRef<HTMLHeadingElement>(null);
  return (
    <>
      <h2 ref={returnRef} tabIndex={-1}>
        Destino
      </h2>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Abrir
      </button>
      {open ? (
        <ConfirmDialog
          title="Remover o item?"
          confirmLabel="Remover"
          pending={pending}
          error={error}
          {...(useReturnFocus ? { returnFocusRef: returnRef } : {})}
          onConfirm={onConfirm}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        >
          <p>O item some da lista.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

async function openDialog(props: HarnessProps = {}) {
  render(<Harness {...props} />);
  const opener = screen.getByRole('button', { name: 'Abrir' });
  await userEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Remover o item?' });
  return { opener, dialog };
}

describe('ConfirmDialog', () => {
  it('starts with focus on Cancelar', async () => {
    const { dialog } = await openDialog();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus(),
    );
    expect(within(dialog).getByText('O item some da lista.')).toBeInTheDocument();
  });

  it('calls onCancel on Escape', async () => {
    const onCancel = vi.fn();
    await openDialog({ onCancel });
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('calls onCancel on a click outside the dialog', async () => {
    const onCancel = vi.fn();
    await openDialog({ onCancel });
    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await userEvent.click(overlay as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm from the destructive confirm button', async () => {
    const onConfirm = vi.fn();
    const { dialog } = await openDialog({ onConfirm });
    const confirm = within(dialog).getByRole('button', { name: 'Remover' });
    expect(confirm).toHaveAttribute('data-variant', 'destructive');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending, and Escape does not cancel', async () => {
    const onCancel = vi.fn();
    const { dialog } = await openDialog({ pending: true, onCancel });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Remover' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the error in an alert inside the dialog', async () => {
    const { dialog } = await openDialog({ error: 'Falhou.' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Falhou.');
  });

  it('returns focus to the opener on close', async () => {
    const { opener } = await openDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('sends focus to returnFocusRef when it holds an element', async () => {
    await openDialog({ useReturnFocus: true });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Destino' })).toHaveFocus());
  });
});
