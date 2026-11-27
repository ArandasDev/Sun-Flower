import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type Row,
  type RowData,
  type SortFn,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { normalizeSearch } from '../search.ts';
import { Input } from './ui/input.tsx';
import { Label } from './ui/label.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.tsx';

interface DataTableColumnMeta {
  /** Extra classes for the column's body cells, such as wrapping long values. */
  cellClassName?: string;
}

const columnMeta: DataTableColumnMeta = {};

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  columnMeta,
});

type Features = typeof features;

/** A column of a `DataTable`; the v9 `ColumnDef` also takes the table's feature set. */
export type DataTableColumn<T extends RowData> = ColumnDef<Features, T, unknown>;

/** The TanStack column helper bound to the `DataTable` features. */
export function createDataTableColumns<T extends RowData>() {
  return createColumnHelper<Features, T>();
}

/** The text a cell value is searched and sorted by; accessors return strings or numbers. */
function cellText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function matchesSearch<T extends RowData>(
  row: Row<Features, T>,
  columnId: string,
  term: string,
): boolean {
  // Surrounding spaces are not part of the term; a blank term filters nothing.
  return normalizeSearch(cellText(row.getValue(columnId))).includes(normalizeSearch(term.trim()));
}

function compareText<T extends RowData>(
  a: Row<Features, T>,
  b: Row<Features, T>,
  columnId: string,
) {
  return cellText(a.getValue(columnId)).localeCompare(cellText(b.getValue(columnId)), 'pt-BR', {
    numeric: true,
  });
}

/**
 * Sorts a column by a value other than the one it shows and searches, such as a date shown in
 * Brazilian format but ordered by its ISO text.
 */
export function sortBy<T extends RowData>(key: (item: T) => string): SortFn<Features, T> {
  return (a, b) => {
    const left = key(a.original);
    const right = key(b.original);
    return left < right ? -1 : left > right ? 1 : 0;
  };
}

/**
 * Renders a header or cell template by calling it, not by mounting it as a component. Screens
 * rebuild their columns on every render (the cells close over mutation state), so a template
 * mounted with `createElement`, as TanStack's `FlexRender` does, would be a new component type
 * each time and React would remount every cell, dropping the focus of a button inside it.
 * Templates therefore must not call hooks.
 */
function renderTemplate<TContext>(
  template: string | ((context: TContext) => ReactNode) | undefined,
  context: TContext,
): ReactNode {
  return typeof template === 'function' ? template(context) : template;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

interface DataTableSearchProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

/**
 * The search field of a `DataTable`. A screen renders it itself, in the toolbar of its `Card`
 * header, and passes the same value to the table's `search`.
 */
export function DataTableSearch({
  value,
  onChange,
  label = 'Buscar',
  className,
}: DataTableSearchProps) {
  const id = useId();
  return (
    <div className={cn('flex w-full max-w-sm flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="search"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

interface DataTableProps<T extends RowData> {
  columns: DataTableColumn<T>[];
  data: T[];
  /** A stable key per item, so a row's DOM (and focus) never passes to another item after a reload. */
  getRowId?: (item: T) => string;
  /**
   * The search term, when the screen renders the field itself with `DataTableSearch` (in the
   * `Card` header toolbar); the table then shows no field of its own.
   */
  search?: string;
  searchLabel?: string;
  /** Shown instead of the table when `data` is empty; without it, nothing is shown. */
  emptyText?: string;
  noResultsText?: string;
}

/**
 * A table with a search field over every accessor column and sorting by header: ascending,
 * descending, then back to the order the server sent. Display columns (row actions) take no part
 * in either.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  search: externalSearch,
  searchLabel = 'Buscar',
  emptyText,
  noResultsText = 'Nenhum resultado para a busca.',
}: DataTableProps<T>) {
  const table = useTable({
    features,
    columns,
    data,
    ...(getRowId === undefined ? {} : { getRowId: (item: T) => getRowId(item) }),
    defaultColumn: { sortFn: compareText },
    globalFilterFn: matchesSearch,
    enableSortingRemoval: true,
    enableMultiSort: false,
    sortDescFirst: false,
    ...(externalSearch === undefined ? {} : { state: { globalFilter: externalSearch } }),
  });

  if (data.length === 0) {
    return emptyText === undefined ? null : (
      <p className="text-sm text-muted-foreground">{emptyText}</p>
    );
  }

  const rows = table.getRowModel().rows;
  const search = typeof table.state.globalFilter === 'string' ? table.state.globalFilter : '';

  return (
    <div className="flex flex-col gap-3">
      {externalSearch === undefined ? (
        <DataTableSearch
          label={searchLabel}
          value={search}
          onChange={(value) => {
            table.setGlobalFilter(value);
          }}
        />
      ) : null}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                if (header.isPlaceholder) return <TableHead key={header.id} scope="col" />;
                const column = header.column;
                if (!column.getCanSort()) {
                  return (
                    <TableHead key={header.id} scope="col">
                      {renderTemplate(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                }
                const sorted = column.getIsSorted();
                const Icon =
                  sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === false ? 'none' : ARIA_SORT[sorted]}
                  >
                    <button
                      type="button"
                      className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      onClick={() => {
                        column.toggleSorting();
                      }}
                    >
                      {renderTemplate(header.column.columnDef.header, header.getContext())}
                      <Icon
                        aria-hidden="true"
                        className={cn('size-3.5', sorted === false && 'text-muted-foreground')}
                      />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.getAllLeafColumns().length}
                className="py-6 text-center text-muted-foreground"
              >
                {noResultsText}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} className="align-top">
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
                    {renderTemplate(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
