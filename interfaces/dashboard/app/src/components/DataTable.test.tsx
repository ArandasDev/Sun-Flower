import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { DataTable, DataTableSearch, createDataTableColumns } from './DataTable.tsx';

interface Item {
  name: string;
  kind: string;
}

const helper = createDataTableColumns<Item>();
const columns = helper.columns([
  helper.accessor('name', { header: 'Nome' }),
  helper.accessor('kind', { header: 'Tipo' }),
  helper.display({
    id: 'actions',
    header: 'Ações',
    cell: ({ row }) => <button type="button">Abrir {row.original.name}</button>,
  }),
]);

// Server order: deliberately neither ascending nor descending.
const DATA: Item[] = [
  { name: 'Beta', kind: 'abc' },
  { name: 'Domínio', kind: 'xyz' },
  { name: 'Alfa', kind: 'ABC' },
];

const names = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');

describe('DataTable', () => {
  it('starts in the server order inside a scrollable container', () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    expect(names()).toEqual(['Beta', 'Domínio', 'Alfa']);
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
  });

  it('finds "Domínio" when searching "dominio"', async () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    await userEvent.type(screen.getByLabelText('Buscar'), 'dominio');
    expect(names()).toEqual(['Domínio']);
  });

  it('finds "abc" and "ABC" when searching "ABC"', async () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    await userEvent.type(screen.getByLabelText('Buscar'), 'ABC');
    expect(names()).toEqual(['Beta', 'Alfa']);
  });

  it('ignores spaces around the term, and a blank term filters nothing', async () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    const search = screen.getByLabelText('Buscar');
    await userEvent.type(search, '  dominio  ');
    expect(names()).toEqual(['Domínio']);
    await userEvent.clear(search);
    await userEvent.type(search, '   ');
    expect(names()).toEqual(['Beta', 'Domínio', 'Alfa']);
    expect(screen.queryByText('Nenhum resultado para a busca.')).toBeNull();
  });

  it('shows its own text when the search finds nothing, not the empty text', async () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    await userEvent.type(screen.getByLabelText('Buscar'), 'zzz');
    expect(screen.getByText('Nenhum resultado para a busca.')).toBeInTheDocument();
    expect(screen.queryByText('Nada aqui.')).toBeNull();
  });

  it('shows the empty text when there is no data at all', () => {
    render(<DataTable columns={columns} data={[]} emptyText="Nada aqui." />);
    expect(screen.getByText('Nada aqui.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum resultado para a busca.')).toBeNull();
  });

  it('does not search the action column', async () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    await userEvent.type(screen.getByLabelText('Buscar'), 'Abrir');
    expect(screen.getByText('Nenhum resultado para a busca.')).toBeInTheDocument();
  });

  it('searches with a field the screen renders itself, and then shows none of its own', async () => {
    function Screen() {
      const [search, setSearch] = useState('');
      return (
        <>
          <DataTableSearch value={search} onChange={setSearch} />
          <DataTable columns={columns} data={DATA} search={search} />
        </>
      );
    }
    render(<Screen />);
    expect(screen.getAllByLabelText('Buscar')).toHaveLength(1);
    await userEvent.type(screen.getByLabelText('Buscar'), '  dominio  ');
    expect(names()).toEqual(['Domínio']);
  });

  it('cycles ascending, descending and back to the server order', async () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    const header = screen.getByRole('columnheader', { name: 'Nome' });
    const button = within(header).getByRole('button', { name: 'Nome' });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual(['Alfa', 'Beta', 'Domínio']);
    await userEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['Domínio', 'Beta', 'Alfa']);
    await userEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(names()).toEqual(['Beta', 'Domínio', 'Alfa']);
  });

  it('leaves the action column without sorting', () => {
    render(<DataTable columns={columns} data={DATA} emptyText="Nada aqui." />);
    const header = screen.getByRole('columnheader', { name: 'Ações' });
    expect(header).not.toHaveAttribute('aria-sort');
    expect(within(header).queryByRole('button')).toBeNull();
  });

  it('keeps focus in a cell when the screen rebuilds its columns on a re-render', () => {
    const build = () =>
      helper.columns([
        helper.accessor('name', { header: 'Nome' }),
        helper.display({
          id: 'actions',
          header: 'Ações',
          cell: ({ row }) => <button type="button">Abrir {row.original.name}</button>,
        }),
      ]);
    const view = render(<DataTable columns={build()} data={DATA} getRowId={(item) => item.name} />);
    const button = screen.getByRole('button', { name: 'Abrir Beta' });
    button.focus();
    view.rerender(<DataTable columns={build()} data={DATA} getRowId={(item) => item.name} />);
    expect(screen.getByRole('button', { name: 'Abrir Beta' })).toBe(button);
    expect(button).toHaveFocus();
  });
});
