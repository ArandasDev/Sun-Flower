import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge, type StatusTone } from './StatusBadge.tsx';

describe('StatusBadge', () => {
  it.each<[StatusTone, string]>([
    ['active', 'default'],
    ['inactive', 'secondary'],
    ['failed', 'destructive'],
    ['pending', 'outline'],
  ])('maps %s to the %s variant', (tone, variant) => {
    render(<StatusBadge tone={tone}>Situação</StatusBadge>);
    expect(screen.getByText('Situação')).toHaveAttribute('data-variant', variant);
  });
});
