import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
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
    <section>
      <h1 ref={headingRef} tabIndex={-1}>
        Sessões
      </h1>
      <p className="muted">
        Sessões abertas no painel. Encerrar uma sessão fecha o painel dessa pessoa na hora.
      </p>
      <p role="alert" className="form-error">
        {query.isError ? errorText(query.error) : null}
      </p>
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {query.isSuccess && sessions.length === 0 ? (
        <p className="muted">Nenhuma sessão aberta.</p>
      ) : null}
      <div className="grant-groups">
        {[...groups.entries()].map(([userId, entries]) => (
          <section key={userId} className="panel" aria-label={`Sessões de ${userId}`}>
            <div className="session-head">
              <h2 className="mono">
                {userId}
                {userId === me.id ? <strong className="self-mark"> Você</strong> : null}
              </h2>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  open({ kind: 'all', userId });
                }}
              >
                Encerrar todas desta pessoa
              </button>
            </div>
            <ul className="domain-rows">
              {entries.map((entry) => (
                <li key={entry.ref}>
                  <span>
                    Criada em {formatDate(entry.createdAt)}
                    <span className="muted">, último uso {formatDate(entry.lastSeenAt)}</span>
                  </span>
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => {
                      open({ kind: 'one', entry });
                    }}
                  >
                    Encerrar
                  </button>
                </li>
              ))}
            </ul>
          </section>
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
              Encerrar esta sessão de <span className="mono">{ending.entry.userId}</span>? A pessoa
              precisa entrar de novo nesse navegador.
            </p>
          ) : (
            <p>
              Encerrar todas as sessões de <span className="mono">{ending.userId}</span>? A pessoa
              precisa entrar de novo em todos os navegadores.
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
