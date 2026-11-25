import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { isSnowflake } from '../ids.ts';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';

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
  const [permission, setPermission] = useState('');
  const [roleId, setRoleId] = useState('');
  const query = useOperationQuery<GrantList>(['admin', 'grants'], 'administration.grants.list', {});
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['admin', 'grants'] });
  };
  const grant = useOperationMutation<unknown, GrantInput>('administration.grants.grant', {
    onSuccess: () => {
      setRoleId('');
      refresh();
    },
  });
  const revoke = useOperationMutation<unknown, GrantInput>('administration.grants.revoke', {
    onSuccess: refresh,
  });
  const error = grant.error ?? revoke.error ?? (query.isError ? query.error : null);
  const grantable = query.data?.grantable ?? [];
  const selected = grantable.includes(permission) ? permission : (grantable[0] ?? '');
  const trimmed = roleId.trim();
  const valid = isSnowflake(trimmed);
  const groups = groupByPermission(query.data?.grants ?? []);

  return (
    <section>
      <h1>Permissões</h1>
      <p className="muted">
        Associe as permissões dos módulos aos cargos do servidor. Quem tem o cargo passa a ter a
        permissão.
      </p>
      <form
        className="inline-form panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && selected !== '') grant.mutate({ permission: selected, roleId: trimmed });
        }}
      >
        <label>
          Permissão
          <select
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
          </select>
        </label>
        <label>
          ID do cargo
          <input
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
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={grant.isPending || !valid || selected === ''}
        >
          Associar
        </button>
      </form>
      <p role="alert" className="form-error">
        {error === null ? null : errorText(error)}
      </p>
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {query.isSuccess && groups.length === 0 ? (
        <p className="muted">Nenhuma permissão associada a cargos.</p>
      ) : null}
      <div className="grant-groups">
        {groups.map(([name, entries]) => (
          <section key={name} className="panel" aria-label={name}>
            <h2 className="mono">{name}</h2>
            <ul className="domain-rows">
              {entries.map((entry) => (
                <li key={entry.roleId}>
                  <span>
                    <span className="mono">{entry.roleId}</span>
                    <span className="muted"> desde {formatDate(entry.grantedAt)}</span>
                  </span>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={revoke.isPending}
                    onClick={() => {
                      revoke.mutate({ permission: entry.permission, roleId: entry.roleId });
                    }}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
