import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RemoveButton } from './RemoveButton.tsx';

describe('RemoveButton', () => {
  it('is a red ghost "Remover" whose hover keeps a red tint instead of bg-accent', async () => {
    const onClick = vi.fn();
    render(
      <>
        <span id="item">exemplo.com</span>
        <RemoveButton aria-describedby="item" onClick={onClick} />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Remover' });
    expect(button).toHaveAccessibleDescription('exemplo.com');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass(
      'text-destructive',
      'hover:bg-destructive/10',
      'hover:text-red-700',
      'dark:hover:bg-destructive/10',
      'dark:hover:text-red-400',
    );
    expect(button).not.toHaveClass('hover:bg-accent', 'dark:hover:bg-accent/50');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not run while disabled', async () => {
    const onClick = vi.fn();
    render(<RemoveButton disabled onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
