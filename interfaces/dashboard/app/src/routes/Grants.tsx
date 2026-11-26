import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
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
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [permission, setPermission] = useState('');
  const [roleId, setRoleId] = useState('');
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
      refresh();
      inputRef.current?.focus();
    },
  });
  const revoke = useOperationMutation<unknown, GrantInput>('administration.grants.revoke', {
    onSuccess: () => {
      notify('Permissão removida.');
      refresh();
      selectRef.current?.focus();
    },
  });
  const error = grant.error ?? revoke.error ?? (query.isError ? query.error : null);
  const grantable = query.data?.grantable ?? [];
  const selected = grantable.includes(permission) ? permission : (grantable[0] ?? '');
  const trimmed = roleId.trim();
  const valid = isSnowflake(trimmed);
  const groups = groupByPermission(query.data?.grants ?? []);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Permissões</h1>
      <p className="text-sm text-muted-foreground">
        Associe as permissões dos módulos aos cargos do servidor. Quem tem o cargo passa a ter a
        permissão.
      </p>
      <Card>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && selected !== '') {
                revoke.reset();
                grant.mutate({ permission: selected, roleId: trimmed });
              }
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={selectId}>Permissão</Label>
              <NativeSelect
                id={selectId}
                ref={selectRef}
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
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor={inputId}>ID do cargo</Label>
              <Input
                id={inputId}
                ref={inputRef}
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
            <Button type="submit" disabled={grant.isPending || !valid || selected === ''}>
              Associar
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
      {query.isSuccess && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma permissão associada a cargos.</p>
      ) : null}
      <div className="flex flex-col gap-4">
        {groups.map(([name, entries]) => (
          <Card key={name} role="region" aria-label={name}>
            <CardHeader>
              <CardTitle>
                <h2 className="font-mono text-base font-semibold break-all">{name}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y rounded-md border">
                {entries.map((entry) => (
                  <li
                    key={entry.roleId}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-mono break-all">{entry.roleId}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        desde {formatDate(entry.grantedAt)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => {
                        grant.reset();
                        revoke.mutate({ permission: entry.permission, roleId: entry.roleId });
                      }}
                    >
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
