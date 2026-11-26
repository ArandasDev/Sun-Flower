import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../api.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
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

const TITLE_CLASS = 'text-2xl font-semibold tracking-tight';

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
      <section className="flex flex-col gap-4">
        <h1 className={TITLE_CLASS}>Visão geral</h1>
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      </section>
    );
  }
  if (query.isPending) {
    return (
      <section className="flex max-w-2xl flex-col gap-4">
        <h1 className={TITLE_CLASS}>Visão geral</h1>
        <p className="sr-only">Carregando…</p>
        <Skeleton aria-hidden="true" className="h-24 w-full" />
        <Skeleton aria-hidden="true" className="h-40 w-full" />
      </section>
    );
  }
  const status = query.data;
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className={TITLE_CLASS}>Visão geral</h1>
      <Card>
        <CardContent>
          <dl className="flex flex-wrap gap-x-12 gap-y-4">
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">Conexão</dt>
              <dd>
                <Badge variant={status.connection === 'disconnected' ? 'destructive' : 'secondary'}>
                  {connectionLabel(status.connection)}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">Tempo no ar</dt>
              <dd className="text-lg font-semibold">{formatUptime(status.uptimeMs)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <h2 className="text-lg font-semibold">Módulos</h2>
      <Card className="py-2">
        <ul className="divide-y">
          {status.modules.map((module) => (
            <li key={module.id} className="flex items-center justify-between gap-4 px-6 py-2.5">
              <span className="font-mono text-sm">{module.id}</span>
              <Badge variant={module.state === 'FAILED' ? 'destructive' : 'secondary'}>
                {moduleStateLabel(module.state)}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
