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
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('marks a destructive item with a red icon and keeps its highlighted text readable', async () => {
    const user = userEvent.setup();
    render(
      <RowActions
        label="Ações"
        items={[
          { label: 'Editar', onSelect: () => {} },
          { label: 'Encerrar todas desta pessoa', onSelect: () => {}, destructive: true },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Ações' }));
    const item = screen.getByRole('menuitem', { name: 'Encerrar todas desta pessoa' });
    expect(item).toHaveClass(
      'text-destructive',
      'focus:text-accent-foreground',
      'data-[highlighted]:text-accent-foreground',
    );
    expect(item).not.toHaveClass('focus:text-destructive');
    const icon = item.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass('text-destructive');
    const plain = screen.getByRole('menuitem', { name: 'Editar' });
    expect(plain).not.toHaveClass('text-destructive');
    expect(plain.querySelector('svg')).toBeNull();
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
