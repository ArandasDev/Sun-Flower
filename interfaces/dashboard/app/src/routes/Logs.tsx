import { useId, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { DataTable, createDataTableColumns, sortBy } from '../components/DataTable.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Label } from '../components/ui/label.tsx';
import { NativeSelect } from '../components/ui/native-select.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { errorText } from '../labels.ts';
import { useOperationQuery } from '../operations.ts';

type MinLevel = 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  time: string;
  level: string;
  message: string;
  module?: string;
  fields: Record<string, string | number | boolean | null>;
}

const LIMIT = 200;

const LEVEL_OPTIONS: readonly { value: MinLevel; label: string }[] = [
  { value: 'info', label: 'Informação' },
  { value: 'warn', label: 'Aviso' },
  { value: 'error', label: 'Erro' },
  { value: 'fatal', label: 'Fatal' },
];

function levelLabel(level: string): string {
  return LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

function levelVariant(level: string): 'secondary' | 'outline' | 'destructive' {
  if (level === 'error' || level === 'fatal') return 'destructive';
  if (level === 'warn') return 'outline';
  return 'secondary';
}

function fieldsText(fields: LogEntry['fields']): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');
}

const column = createDataTableColumns<LogEntry>();

const COLUMNS = column.columns([
  column.accessor((entry) => formatDate(entry.time), {
    id: 'time',
    header: 'Hora',
    sortFn: sortBy((entry) => entry.time),
  }),
  column.accessor((entry) => levelLabel(entry.level), {
    id: 'level',
    header: 'Nível',
    cell: ({ row, getValue }) => (
      <Badge variant={levelVariant(row.original.level)}>{getValue()}</Badge>
    ),
  }),
  column.accessor((entry) => entry.module ?? '—', {
    id: 'module',
    header: 'Módulo',
    meta: { cellClassName: 'wrap-anywhere whitespace-normal' },
  }),
  column.accessor('message', {
    header: 'Mensagem',
    meta: { cellClassName: 'wrap-anywhere whitespace-pre-wrap' },
  }),
  column.accessor((entry) => fieldsText(entry.fields), {
    id: 'fields',
    header: 'Campos',
    meta: { cellClassName: 'font-mono text-xs wrap-anywhere whitespace-pre-wrap' },
  }),
]);

export function Logs() {
  const levelId = useId();
  const [minLevel, setMinLevel] = useState<MinLevel>('info');
  const query = useOperationQuery<{ entries: LogEntry[] }>(
    ['admin', 'logs', minLevel],
    'administration.logs.recent',
    { limit: LIMIT, minLevel },
    { keepPrevious: true, refetchOnFocus: false },
  );
  const entries = query.data?.entries ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
      <p className="text-sm text-muted-foreground">
        Os registros mais recentes do bot, do mais novo para o mais antigo. Eles só se atualizam
        quando você abre a tela ou usa o botão Atualizar.
      </p>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={levelId}>Nível mínimo</Label>
            <NativeSelect
              id={levelId}
              value={minLevel}
              onChange={(event) => {
                setMinLevel(event.target.value as MinLevel);
              }}
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            type="button"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            Atualizar
          </Button>
        </CardContent>
      </Card>
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {query.isError ? errorText(query.error) : null}
      </p>
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <p className="sr-only">Carregando…</p>
          {[0, 1].map((index) => (
            <Skeleton key={index} aria-hidden="true" className="h-9 w-full" />
          ))}
        </div>
      ) : null}
      {entries.length > 0 || query.isSuccess ? (
        <Card>
          <CardContent>
            <DataTable columns={COLUMNS} data={entries} emptyText="Nenhum registro." />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
