import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { AddDialog } from '../components/AddDialog.tsx';
import { DataTable, DataTableSearch, createDataTableColumns } from '../components/DataTable.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { notify } from '../toast.ts';

type ListName = 'block' | 'allow';

interface DomainRow {
  domain: string;
}

const column = createDataTableColumns<DomainRow>();

interface DomainListProps {
  list: ListName;
  title: string;
  dialogTitle: string;
}

function DomainList({ list, title, dialogTitle }: DomainListProps) {
  const client = useQueryClient();
  const titleId = useId();
  const inputId = useId();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const query = useOperationQuery<{ domains: string[] }>(
    ['domains', list],
    'moderation.domains.list',
    { list },
  );
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['domains'] });
  };
  const add = useOperationMutation<unknown, { domain: string }>(`moderation.domains.${list}`, {
    onSuccess: () => {
      notify('Domínio adicionado.');
      setText('');
      setAdding(false);
      refresh();
    },
  });
  const remove = useOperationMutation<unknown, { domain: string }>('moderation.domains.remove', {
    onSuccess: () => {
      notify('Domínio removido.');
      refresh();
    },
  });
  const error = remove.error ?? (query.isError ? query.error : null);
  const trimmed = text.trim();
  const domains = query.data?.domains ?? [];
  const rows = domains.map((domain) => ({ domain }));
  const domainId = (index: number): string => `${titleId}-d${String(index)}`;
  const columns = column.columns([
    column.accessor('domain', {
      header: 'Domínio',
      cell: ({ row }) => (
        <span className="font-mono break-all whitespace-normal" id={domainId(row.index)}>
          {row.original.domain}
        </span>
      ),
    }),
    column.display({
      id: 'actions',
      header: 'Ações',
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          aria-describedby={domainId(row.index)}
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate({ domain: row.original.domain });
          }}
        >
          <Trash2 aria-hidden="true" />
          Remover
        </Button>
      ),
    }),
  ]);

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
        </CardTitle>
        <CardAction>
          <AddDialog
            triggerLabel="Adicionar"
            triggerVariant="outline"
            triggerSize="sm"
            triggerDescribedBy={titleId}
            title={dialogTitle}
            submitLabel="Adicionar"
            open={adding}
            onOpenChange={(open) => {
              setAdding(open);
              if (!open) add.reset();
            }}
            onSubmit={() => {
              remove.reset();
              add.mutate({ domain: trimmed });
            }}
            pending={add.isPending}
            canSubmit={trimmed !== ''}
            error={add.error === null ? null : errorText(add.error)}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>Domínio</Label>
              <Input
                id={inputId}
                type="text"
                autoComplete="off"
                maxLength={253}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            </div>
          </AddDialog>
        </CardAction>
        {domains.length === 0 ? null : (
          <DataTableSearch value={search} onChange={setSearch} className="mt-2" />
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p role="alert" className="text-sm text-destructive empty:hidden">
          {error === null ? null : errorText(error)}
        </p>
        {query.isPending ? (
          <div className="flex flex-col gap-2">
            <p className="sr-only">Carregando…</p>
            {[0, 1].map((index) => (
              <Skeleton key={index} aria-hidden="true" className="h-9 w-full" />
            ))}
          </div>
        ) : null}
        {query.isSuccess && domains.length === 0 ? (
          <EmptyState title="Nenhum domínio nesta lista." />
        ) : null}
        {domains.length === 0 ? null : (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(item) => item.domain}
            search={search}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function Domains() {
  return (
    <>
      <PageHeader
        title="Domínios"
        description="Domínios bloqueados contam como sinal forte de golpe. Links para domínios permitidos são ignorados na análise."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <DomainList list="block" title="Bloqueados" dialogTitle="Adicionar domínio bloqueado" />
        <DomainList list="allow" title="Permitidos" dialogTitle="Adicionar domínio permitido" />
      </div>
    </>
  );
}
