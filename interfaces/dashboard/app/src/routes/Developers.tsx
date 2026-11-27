import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { AddDialog } from '../components/AddDialog.tsx';
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
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { RemoveButton } from '../components/RemoveButton.tsx';
import { Card, CardContent, CardHeader } from '../components/ui/card.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { isSnowflake } from '../ids.ts';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { notify } from '../toast.ts';
import { useCurrentMe } from '../session.tsx';

interface DeveloperEntry {
  userId: string;
  addedAt: string;
}

const column = createDataTableColumns<DeveloperEntry>();

export function Developers() {
  const client = useQueryClient();
  const me = useCurrentMe();
  const inputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [userId, setUserId] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
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
      notify('Desenvolvedor adicionado.');
      setUserId('');
      setAdding(false);
      refresh();
    },
  });
  const remove = useOperationMutation<unknown, { userId: string }>(
    'administration.developers.remove',
    {
      onSuccess: () => {
        notify('Desenvolvedor removido.');
        setRemoving(null);
        refresh();
      },
    },
  );
  const error = query.isError ? query.error : null;
  const trimmed = userId.trim();
  const valid = isSnowflake(trimmed);
  const developers = query.data?.developers ?? [];
  const columns = column.columns([
    column.accessor('userId', {
      header: 'Pessoa',
      cell: ({ row }) => (
        <span className="break-all whitespace-normal">
          <span className="font-mono">{row.original.userId}</span>
          {row.original.userId === me.id ? <strong className="font-semibold"> Você</strong> : null}
        </span>
      ),
    }),
    column.accessor((entry) => formatDate(entry.addedAt), {
      id: 'addedAt',
      header: 'Desde',
      sortFn: sortBy((entry) => entry.addedAt),
    }),
    column.display({
      id: 'actions',
      header: 'Ações',
      cell: ({ row }) => (
        <RemoveButton
          onClick={() => {
            remove.reset();
            setRemoving(row.original.userId);
          }}
        />
      ),
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Desenvolvedores"
        description="Desenvolvedores têm acesso total ao painel e podem administrar o bot."
        actions={
          <AddDialog
            triggerLabel="Adicionar desenvolvedor"
            triggerRef={triggerRef}
            title="Adicionar desenvolvedor"
            submitLabel="Adicionar"
            open={adding}
            onOpenChange={(open) => {
              setAdding(open);
              if (!open) add.reset();
            }}
            onSubmit={() => {
              add.mutate({ userId: trimmed });
            }}
            pending={add.isPending}
            canSubmit={valid}
            error={add.error === null ? null : errorText(add.error)}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>ID da pessoa</Label>
              <Input
                id={inputId}
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
          </AddDialog>
        }
      />
      {error === null ? null : (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errorText(error)}</AlertDescription>
        </Alert>
      )}
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <p className="sr-only">Carregando…</p>
          {[0, 1].map((index) => (
            <Skeleton key={index} aria-hidden="true" className="h-9 w-full" />
          ))}
        </div>
      ) : null}
      {query.isSuccess && developers.length === 0 ? (
        <EmptyState title="Nenhum desenvolvedor." />
      ) : null}
      {developers.length === 0 ? null : (
        <Card>
          <CardHeader className="border-b">
            <DataTableSearch value={search} onChange={setSearch} />
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={developers}
              getRowId={(entry) => entry.userId}
              search={search}
            />
          </CardContent>
        </Card>
      )}
      {removing === null ? null : (
        <ConfirmDialog
          title="Remover desenvolvedor"
          confirmLabel="Remover"
          pending={remove.isPending}
          error={remove.error === null ? null : errorText(remove.error)}
          returnFocusRef={triggerRef}
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
    </>
  );
}
