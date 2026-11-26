import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';

type ListName = 'block' | 'allow';

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
      setText('');
      refresh();
    },
  });
  const remove = useOperationMutation<unknown, { domain: string }>('moderation.domains.remove', {
    onSuccess: refresh,
  });
  const error = add.error ?? remove.error ?? (query.isError ? query.error : null);
  const domains = query.data?.domains ?? [];

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
        {query.isSuccess && domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum domínio nesta lista.</p>
        ) : null}
        {domains.length === 0 ? null : (
          <ul className="flex flex-col divide-y rounded-md border">
            {domains.map((domain, index) => (
              <li key={domain} className="flex items-center justify-between gap-3 px-3 py-2">
                <span
                  className="min-w-0 font-mono text-sm break-all"
                  id={`${titleId}-d${String(index)}`}
                >
                  {domain}
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  aria-describedby={`${titleId}-d${String(index)}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate({ domain });
                  }}
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
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
