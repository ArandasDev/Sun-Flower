import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { useCurrentMe } from '../session.tsx';

interface SessionEntry {
  ref: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
}

type Ending = { kind: 'one'; entry: SessionEntry } | { kind: 'all'; userId: string };

export function Sessions() {
  const client = useQueryClient();
  const me = useCurrentMe();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const query = useOperationQuery<{ sessions: SessionEntry[] }>(
    ['admin', 'sessions'],
    'administration.sessions.list',
    {},
    { refetchOnFocus: false },
  );
  const options = {
    onSuccess: () => {
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
  const groups = new Map<string, SessionEntry[]>();
  for (const entry of sessions) {
    groups.set(entry.userId, [...(groups.get(entry.userId) ?? []), entry]);
  }
  const failure = revoke.error ?? revokeAll.error;

  // Only the latest attempt's error is shown, so both mutations start clean.
  const open = (next: Ending): void => {
    revoke.reset();
    revokeAll.reset();
    setEnding(next);
  };

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
      {query.isSuccess && sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma sessão aberta.</p>
      ) : null}
      <div className="flex flex-col gap-4">
        {[...groups.entries()].map(([userId, entries]) => (
          <Card key={userId} role="region" aria-label={`Sessões de ${userId}`}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>
                <h2 className="font-mono text-base font-semibold break-all">
                  {userId}
                  {userId === me.id ? (
                    <strong className="font-sans font-semibold"> Você</strong>
                  ) : null}
                </h2>
              </CardTitle>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  open({ kind: 'all', userId });
                }}
              >
                Encerrar todas desta pessoa
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y rounded-md border">
                {entries.map((entry) => (
                  <li key={entry.ref} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      Criada em {formatDate(entry.createdAt)}
                      <span className="text-muted-foreground">
                        , último uso {formatDate(entry.lastSeenAt)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        open({ kind: 'one', entry });
                      }}
                    >
                      Encerrar
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
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
