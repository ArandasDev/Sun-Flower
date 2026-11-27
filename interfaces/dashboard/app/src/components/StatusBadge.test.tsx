import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge, type StatusTone } from './StatusBadge.tsx';

describe('StatusBadge', () => {
  it.each<[StatusTone, string]>([
    ['active', 'bg-primary'],
    ['inactive', 'bg-muted-foreground'],
    ['failed', 'bg-destructive'],
    ['pending', 'border-muted-foreground'],
  ])('renders %s as an outline badge with a %s dot', (tone, dotClass) => {
    render(<StatusBadge tone={tone}>Situação</StatusBadge>);
    const badge = screen.getByText('Situação');
    expect(badge).toHaveAttribute('data-variant', 'outline');
    expect(badge).toHaveAttribute('data-tone', tone);
    const dot = badge.querySelector('span');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveClass('size-1.5', dotClass);
  });

  it('colours the text only for failed', () => {
    render(
      <>
        <StatusBadge tone="failed">Falhou</StatusBadge>
        <StatusBadge tone="active">Ligado</StatusBadge>
      </>,
    );
    expect(screen.getByText('Falhou')).toHaveClass('text-destructive');
    expect(screen.getByText('Ligado')).not.toHaveClass('text-destructive');
  });
});
