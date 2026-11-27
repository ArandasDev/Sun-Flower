import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RowActions } from './RowActions.tsx';

describe('RowActions', () => {
  it('opens from the named trigger and runs the chosen item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RowActions
        label="Ações de Ana"
        items={[
          { label: 'Editar', onSelect },
          { label: 'Remover', onSelect: () => {}, destructive: true },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Ações de Ana' }));
    expect(screen.getByRole('menuitem', { name: 'Remover' })).toHaveClass('text-destructive');
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not run a disabled item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RowActions label="Ações" items={[{ label: 'Editar', onSelect, disabled: true }]} />);
    await user.click(screen.getByRole('button', { name: 'Ações' }));
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
