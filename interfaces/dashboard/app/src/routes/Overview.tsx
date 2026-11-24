import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../api.ts';
import { formatUptime } from '../format.ts';
import { connectionLabel, moduleStateLabel } from '../labels.ts';
import { NoPermission } from './NoPermission.tsx';

interface Status {
  connection: string;
  uptimeMs: number;
  modules: { id: string; state: string }[];
}

/** Poll every 15 s, but stop after an error (a 403 or 401 will not fix itself). */
export function statusRefetchInterval(query: { state: { status: string } }): number | false {
  return query.state.status === 'error' ? false : 15_000;
}

export function Overview() {
  const query = useQuery({
    queryKey: ['status'],
    queryFn: () => apiFetch<Status>('/api/status'),
    retry: false,
    refetchInterval: statusRefetchInterval,
  });
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 403) return <NoPermission />;
    return (
      <section>
        <h1>Visão geral</h1>
        <p role="alert">{query.error.message}</p>
      </section>
    );
  }
  if (query.isPending) {
    return (
      <section>
        <h1>Visão geral</h1>
        <p className="muted">Carregando…</p>
      </section>
    );
  }
  const status = query.data;
  return (
    <section>
      <h1>Visão geral</h1>
      <div className="panel">
        <dl className="facts">
          <div>
            <dt>Conexão</dt>
            <dd className={`connection connection-${status.connection}`}>
              {connectionLabel(status.connection)}
            </dd>
          </div>
          <div>
            <dt>Tempo no ar</dt>
            <dd>{formatUptime(status.uptimeMs)}</dd>
          </div>
        </dl>
      </div>
      <h2>Módulos</h2>
      <ul className="panel modules">
        {status.modules.map((module) => (
          <li key={module.id}>
            <span>{module.id}</span>
            <span className={`state state-${module.state.toLowerCase()}`}>
              {moduleStateLabel(module.state)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
