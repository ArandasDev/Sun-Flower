import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { isSnowflake } from '../ids.ts';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { useCurrentMe } from '../session.tsx';

interface DeveloperEntry {
  userId: string;
  addedAt: string;
}

export function Developers() {
  const client = useQueryClient();
  const me = useCurrentMe();
  const inputRef = useRef<HTMLInputElement>(null);
  const [userId, setUserId] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const query = useOperationQuery<{ developers: DeveloperEntry[] }>(
    ['admin', 'developers'],
    'administration.developers.list',
    {},
    { refetchOnFocus: false },
  );
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['admin', 'developers'] });
  };
  const add = useOperationMutation<unknown, { userId: string }>('administration.developers.add', {
    onSuccess: () => {
      setUserId('');
      refresh();
      inputRef.current?.focus();
    },
  });
  const remove = useOperationMutation<unknown, { userId: string }>(
    'administration.developers.remove',
    {
      onSuccess: () => {
        setRemoving(null);
        refresh();
      },
    },
  );
  const error = add.error ?? (query.isError ? query.error : null);
  const trimmed = userId.trim();
  const valid = isSnowflake(trimmed);
  const developers = query.data?.developers ?? [];

  return (
    <section>
      <h1>Desenvolvedores</h1>
      <p className="muted">Desenvolvedores têm acesso total ao painel e podem administrar o bot.</p>
      <form
        className="inline-form panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) add.mutate({ userId: trimmed });
        }}
      >
        <label>
          ID da pessoa
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            value={userId}
            aria-invalid={trimmed !== '' && !valid}
            onChange={(event) => {
              setUserId(event.target.value);
            }}
          />
        </label>
        <button type="submit" className="button button-primary" disabled={add.isPending || !valid}>
          Adicionar
        </button>
      </form>
      <p role="alert" className="form-error">
        {error === null ? null : errorText(error)}
      </p>
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {developers.length === 0 ? null : (
        <div className="panel">
          <ul className="domain-rows">
            {developers.map((entry) => (
              <li key={entry.userId}>
                <span>
                  <span className="mono">{entry.userId}</span>
                  {entry.userId === me.id ? <strong className="self-mark"> Você</strong> : null}
                  <span className="muted"> desde {formatDate(entry.addedAt)}</span>
                </span>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => {
                    add.reset();
                    remove.reset();
                    setRemoving(entry.userId);
                  }}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {removing === null ? null : (
        <ConfirmDialog
          title="Remover desenvolvedor"
          confirmLabel="Remover"
          pending={remove.isPending}
          error={remove.error === null ? null : errorText(remove.error)}
          returnFocusRef={inputRef}
          onConfirm={() => {
            remove.mutate({ userId: removing });
          }}
          onCancel={() => {
            setRemoving(null);
          }}
        >
          <p>
            Remover <span className="mono">{removing}</span> dos desenvolvedores? A pessoa perde o
            acesso de desenvolvedor ao painel e ao bot.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
