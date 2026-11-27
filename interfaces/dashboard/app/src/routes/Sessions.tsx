import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { DataTable, createDataTableColumns, sortBy } from '../components/DataTable.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { notify } from '../toast.ts';
import { useCurrentMe } from '../session.tsx';

interface SessionEntry {
  ref: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
}

const column = createDataTableColumns<SessionEntry>();

type Ending = { kind: 'one'; entry: SessionEntry } | { kind: 'all'; userId: string };

export function Sessions() {
  const client = useQueryClient();
  const me = useCurrentMe();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const personId = useId();
  const [ending, setEnding] = useState<Ending | null>(null);
  const query = useOperationQuery<{ sessions: SessionEntry[] }>(
    ['admin', 'sessions'],
    'administration.sessions.list',
    {},
    { refetchOnFocus: false },
  );
  const options = {
    onSuccess: () => {
      notify('Sessão revogada.');
      setEnding(null);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'sessions'] });
    },
  };
  const revoke = useOperationMutation<unknown, { ref: string }>(
    'administration.sessions.revoke',
    options,
  );
  const revokeAll = useOperationMutation<unknown, { userId: string }>(
    'administration.sessions.revoke-all',
    options,
  );
  const sessions = query.data?.sessions ?? [];
  const failure = revoke.error ?? revokeAll.error;

  // Only the latest attempt's error is shown, so both mutations start clean.
  const open = (next: Ending): void => {
    revoke.reset();
    revokeAll.reset();
    setEnding(next);
  };

  const columns = column.columns([
    column.accessor('userId', {
      header: 'Pessoa',
      cell: ({ row }) => (
        <span id={`${personId}-${row.id}`} className="font-mono break-all whitespace-normal">
          {row.original.userId}
          {row.original.userId === me.id ? (
            <strong className="font-sans font-semibold"> Você</strong>
          ) : null}
        </span>
      ),
    }),
    column.accessor((entry) => formatDate(entry.createdAt), {
      id: 'createdAt',
      header: 'Criada em',
      sortFn: sortBy((entry) => entry.createdAt),
    }),
    column.accessor((entry) => formatDate(entry.lastSeenAt), {
      id: 'lastSeenAt',
      header: 'Último uso',
      sortFn: sortBy((entry) => entry.lastSeenAt),
    }),
    column.display({
      id: 'actions',
      header: 'Ações',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            aria-describedby={`${personId}-${row.id}`}
            onClick={() => {
              open({ kind: 'one', entry: row.original });
            }}
          >
            Encerrar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            aria-describedby={`${personId}-${row.id}`}
            onClick={() => {
              open({ kind: 'all', userId: row.original.userId });
            }}
          >
            Encerrar todas desta pessoa
          </Button>
        </div>
      ),
    }),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        Sessões
      </h1>
      <p className="text-sm text-muted-foreground">
        Sessões abertas no painel. Encerrar uma sessão fecha o painel dessa pessoa na hora.
      </p>
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
      {sessions.length > 0 || query.isSuccess ? (
        <Card>
          <CardContent>
            <DataTable
              columns={columns}
              data={sessions}
              getRowId={(entry) => entry.ref}
              emptyText="Nenhuma sessão aberta."
            />
          </CardContent>
        </Card>
      ) : null}
      {ending === null ? null : (
        <ConfirmDialog
          title={ending.kind === 'one' ? 'Encerrar sessão' : 'Encerrar todas as sessões'}
          confirmLabel="Encerrar"
          pending={revoke.isPending || revokeAll.isPending}
          error={failure === null ? null : errorText(failure)}
          returnFocusRef={headingRef}
          onConfirm={() => {
            if (ending.kind === 'one') revoke.mutate({ ref: ending.entry.ref });
            else revokeAll.mutate({ userId: ending.userId });
          }}
          onCancel={() => {
            setEnding(null);
          }}
        >
          {ending.kind === 'one' ? (
            <p>
              Encerrar esta sessão de{' '}
              <span className="font-mono break-all">{ending.entry.userId}</span>? A pessoa precisa
              entrar de novo nesse navegador.
            </p>
          ) : (
            <p>
              Encerrar todas as sessões de{' '}
              <span className="font-mono break-all">{ending.userId}</span>? A pessoa precisa entrar
              de novo em todos os navegadores.
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
