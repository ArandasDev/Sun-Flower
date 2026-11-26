import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
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
  const inputId = useId();
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
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Desenvolvedores</h1>
      <p className="text-sm text-muted-foreground">
        Desenvolvedores têm acesso total ao painel e podem administrar o bot.
      </p>
      <Card>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) add.mutate({ userId: trimmed });
            }}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor={inputId}>ID da pessoa</Label>
              <Input
                id={inputId}
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
            </div>
            <Button type="submit" disabled={add.isPending || !valid}>
              Adicionar
            </Button>
          </form>
        </CardContent>
      </Card>
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
      {developers.length === 0 ? null : (
        <Card>
          <CardContent>
            <ul className="flex flex-col divide-y rounded-md border">
              {developers.map((entry) => (
                <li
                  key={entry.userId}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0 text-sm">
                    <span className="font-mono break-all">{entry.userId}</span>
                    {entry.userId === me.id ? (
                      <strong className="font-semibold"> Você</strong>
                    ) : null}
                    <span className="text-muted-foreground">
                      {' '}
                      desde {formatDate(entry.addedAt)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      add.reset();
                      remove.reset();
                      setRemoving(entry.userId);
                    }}
                  >
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
            Remover <span className="font-mono break-all">{removing}</span> dos desenvolvedores? A
            pessoa perde o acesso de desenvolvedor ao painel e ao bot.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
