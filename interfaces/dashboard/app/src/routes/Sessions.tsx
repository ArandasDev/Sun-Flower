import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import {
  DataTable,
  DataTableSearch,
  createDataTableColumns,
  sortBy,
} from '../components/DataTable.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { RowActions } from '../components/RowActions.tsx';
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/card.tsx';
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
  const [search, setSearch] = useState('');
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
        <span className="font-mono break-all whitespace-normal">
          {row.original.userId}
          {row.original.userId === me.id ? (
            <>
              {' '}
              {/* The id may break anywhere; the marker stays one word. */}
              <strong className="font-sans font-semibold break-normal whitespace-nowrap">
                Você
              </strong>
            </>
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
        <RowActions
          label={`Ações da sessão de ${row.original.userId}`}
          items={[
            {
              label: 'Encerrar',
              onSelect: () => {
                open({ kind: 'one', entry: row.original });
              },
            },
            {
              label: 'Encerrar todas desta pessoa',
              destructive: true,
              onSelect: () => {
                open({ kind: 'all', userId: row.original.userId });
              },
            },
          ]}
        />
      ),
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Sessões"
        description="Sessões abertas no painel. Encerrar uma sessão fecha o painel dessa pessoa na hora."
        headingRef={headingRef}
      />
      {query.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errorText(query.error)}</AlertDescription>
        </Alert>
      ) : null}
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <p className="sr-only">Carregando…</p>
          {[0, 1].map((index) => (
            <Skeleton key={index} aria-hidden="true" className="h-9 w-full" />
          ))}
        </div>
      ) : null}
      {query.isSuccess && sessions.length === 0 ? (
        <EmptyState title="Nenhuma sessão aberta." />
      ) : null}
      {sessions.length === 0 ? null : (
        <Card>
          <CardHeader className="border-b">
            <DataTableSearch value={search} onChange={setSearch} />
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={sessions}
              getRowId={(entry) => entry.ref}
              search={search}
            />
          </CardContent>
        </Card>
      )}
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
    </>
  );
}
