import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { AddDialog } from '../components/AddDialog.tsx';
import { formatDate } from '../components/CaseDetail.tsx';
import { DataTable, createDataTableColumns, sortBy } from '../components/DataTable.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { NativeSelect } from '../components/ui/native-select.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { isSnowflake } from '../ids.ts';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { notify } from '../toast.ts';

interface GrantEntry {
  permission: string;
  roleId: string;
  grantedAt: string;
}

interface GrantList {
  grants: GrantEntry[];
  grantable: string[];
}

interface GrantInput {
  permission: string;
  roleId: string;
}

const column = createDataTableColumns<GrantEntry>();

function groupByPermission(grants: GrantEntry[]): [string, GrantEntry[]][] {
  const groups = new Map<string, GrantEntry[]>();
  for (const grant of grants) {
    const group = groups.get(grant.permission);
    if (group === undefined) groups.set(grant.permission, [grant]);
    else group.push(grant);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function Grants() {
  const client = useQueryClient();
  const selectId = useId();
  const inputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [permission, setPermission] = useState('');
  const [roleId, setRoleId] = useState('');
  const [granting, setGranting] = useState(false);
  const query = useOperationQuery<GrantList>(
    ['admin', 'grants'],
    'administration.grants.list',
    {},
    {
      refetchOnFocus: false,
    },
  );
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['admin', 'grants'] });
  };
  const grant = useOperationMutation<unknown, GrantInput>('administration.grants.grant', {
    onSuccess: () => {
      notify('Permissão concedida.');
      setRoleId('');
      setGranting(false);
      refresh();
    },
  });
  const revoke = useOperationMutation<unknown, GrantInput>('administration.grants.revoke', {
    onSuccess: () => {
      notify('Permissão removida.');
      refresh();
      triggerRef.current?.focus();
    },
  });
  const error = revoke.error ?? (query.isError ? query.error : null);
  const grantable = query.data?.grantable ?? [];
  const selected = grantable.includes(permission) ? permission : (grantable[0] ?? '');
  const trimmed = roleId.trim();
  const valid = isSnowflake(trimmed);
  const groups = groupByPermission(query.data?.grants ?? []);
  const columns = column.columns([
    column.accessor('roleId', {
      header: 'Cargo',
      cell: ({ getValue }) => (
        <span className="font-mono break-all whitespace-normal">{getValue()}</span>
      ),
    }),
    column.accessor((entry) => formatDate(entry.grantedAt), {
      id: 'grantedAt',
      header: 'Desde',
      sortFn: sortBy((entry) => entry.grantedAt),
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
          disabled={revoke.isPending}
          onClick={() => {
            grant.reset();
            revoke.mutate({ permission: row.original.permission, roleId: row.original.roleId });
          }}
        >
          <Trash2 aria-hidden="true" />
          Remover
        </Button>
      ),
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Permissões"
        description="Associe as permissões dos módulos aos cargos do servidor. Quem tem o cargo passa a ter a permissão."
        actions={
          <AddDialog
            triggerLabel="Associar permissão"
            triggerRef={triggerRef}
            title="Associar permissão"
            submitLabel="Associar"
            open={granting}
            onOpenChange={(open) => {
              setGranting(open);
              if (!open) grant.reset();
            }}
            onSubmit={() => {
              revoke.reset();
              grant.mutate({ permission: selected, roleId: trimmed });
            }}
            pending={grant.isPending}
            canSubmit={valid && selected !== ''}
            error={grant.error === null ? null : errorText(grant.error)}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={selectId}>Permissão</Label>
              <NativeSelect
                id={selectId}
                value={selected}
                onChange={(event) => {
                  setPermission(event.target.value);
                }}
              >
                {grantable.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>ID do cargo</Label>
              <Input
                id={inputId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                value={roleId}
                aria-invalid={trimmed !== '' && !valid}
                onChange={(event) => {
                  setRoleId(event.target.value);
                }}
              />
            </div>
          </AddDialog>
        }
      />
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
      {query.isSuccess && groups.length === 0 ? (
        <EmptyState title="Nenhuma permissão associada a cargos." />
      ) : null}
      {/* The shell main already spaces its children; each group is one more block. */}
      {groups.map(([name, entries]) => (
        <Card key={name} role="region" aria-label={name}>
          <CardHeader>
            <CardTitle>
              <h2 className="font-mono text-base font-semibold break-all">{name}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={entries}
              getRowId={(entry) => `${entry.permission}:${entry.roleId}`}
            />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
