import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AddDialog } from './AddDialog.tsx';

function Harness({
  onSubmit,
  pending = false,
  canSubmit = true,
  error = null,
  closeOnSubmit = false,
}: {
  onSubmit: () => void;
  pending?: boolean;
  canSubmit?: boolean;
  error?: string | null;
  closeOnSubmit?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AddDialog
      triggerLabel="Adicionar item"
      title="Novo item"
      submitLabel="Adicionar"
      open={open}
      onOpenChange={setOpen}
      onSubmit={() => {
        onSubmit();
        if (closeOnSubmit) setOpen(false);
      }}
      pending={pending}
      canSubmit={canSubmit}
      error={error}
    >
      <label>
        Nome
        <input type="text" />
      </label>
    </AddDialog>
  );
}

describe('AddDialog', () => {
  it('opens from the trigger with the title and the fields', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Adicionar item' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo item' });
    expect(within(dialog).getByLabelText('Nome')).toHaveFocus();
  });

  it('sends on submit, and focus returns to the trigger when the caller closes it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} closeOnSubmit />);
    const trigger = screen.getByRole('button', { name: 'Adicionar item' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('shows the error inside the dialog as an alert', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => {}} error="Falhou." />);
    await user.click(screen.getByRole('button', { name: 'Adicionar item' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Falhou.');
  });

  it('disables submit while pending or invalid, and does not send', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<Harness onSubmit={onSubmit} canSubmit={false} />);
    await user.click(screen.getByRole('button', { name: 'Adicionar item' }));
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeDisabled();
    await user.type(screen.getByLabelText('Nome'), 'x{Enter}');
    rerender(<Harness onSubmit={onSubmit} pending />);
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes on Escape without sending', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const trigger = screen.getByRole('button', { name: 'Adicionar item' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('stays open on Escape while a request runs', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => {}} pending />);
    await user.click(screen.getByRole('button', { name: 'Adicionar item' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
