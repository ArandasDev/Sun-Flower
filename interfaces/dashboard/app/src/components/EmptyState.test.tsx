import { render, screen } from '@testing-library/react';
import { InboxIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.tsx';

describe('EmptyState', () => {
  it('shows the title as visible text and hides the icon', () => {
    const { container } = render(
      <EmptyState icon={InboxIcon} title="Nada aqui." description="Volte depois." />,
    );
    expect(screen.getByText('Nada aqui.')).toBeVisible();
    expect(screen.getByText('Volte depois.')).toBeVisible();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('works without icon and description', () => {
    const { container } = render(<EmptyState title="Vazio." />);
    expect(screen.getByText('Vazio.')).toBeVisible();
    expect(container.querySelector('svg')).toBeNull();
  });
});
