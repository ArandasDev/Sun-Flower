import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { DataTable, createDataTableColumns } from '../components/DataTable.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
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

function DomainList({ list, title }: { list: ListName; title: string }) {
  const client = useQueryClient();
  const titleId = useId();
  const inputId = useId();
  const [text, setText] = useState('');
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
      refresh();
    },
  });
  const remove = useOperationMutation<unknown, { domain: string }>('moderation.domains.remove', {
    onSuccess: () => {
      notify('Domínio removido.');
      refresh();
    },
  });
  const error = add.error ?? remove.error ?? (query.isError ? query.error : null);
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
          variant="destructive"
          size="sm"
          aria-describedby={domainId(row.index)}
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate({ domain: row.original.domain });
          }}
        >
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
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const domain = text.trim();
            if (domain !== '') add.mutate({ domain });
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={inputId}>Adicionar domínio</Label>
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
          <Button type="submit" disabled={add.isPending || text.trim() === ''}>
            Adicionar
          </Button>
        </form>
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
        {domains.length > 0 || query.isSuccess ? (
          <DataTable columns={columns} data={rows} emptyText="Nenhum domínio nesta lista." />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function Domains() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Domínios</h1>
      <p className="text-sm text-muted-foreground">
        Domínios bloqueados contam como sinal forte de golpe. Links para domínios permitidos são
        ignorados na análise.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <DomainList list="block" title="Bloqueados" />
        <DomainList list="allow" title="Permitidos" />
      </div>
    </section>
  );
}
