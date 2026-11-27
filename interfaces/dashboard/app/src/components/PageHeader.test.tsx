import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader.tsx';

describe('PageHeader', () => {
  it('shows the title as h1, the description and the actions', () => {
    render(
      <PageHeader
        title="Casos"
        description="Histórico de casos."
        actions={<button>Novo</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument();
    expect(screen.getByText('Histórico de casos.')).toHaveClass('text-muted-foreground');
    expect(screen.getByRole('button', { name: 'Novo' })).toBeInTheDocument();
  });

  it('renders no actions container without actions', () => {
    const { container } = render(<PageHeader title="Casos" description="Texto." />);
    expect(container.querySelector('header')?.children).toHaveLength(1);
  });
});
