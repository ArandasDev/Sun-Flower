import { useQuery } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError, apiFetch } from '../api.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { StatusBadge, type StatusTone } from '../components/StatusBadge.tsx';
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { cn } from '../lib/utils.ts';
import { formatUptime } from '../format.ts';
import { connectionLabel, moduleStateLabel } from '../labels.ts';
import { useLive } from '../live.ts';
import { useCurrentMe } from '../session.tsx';
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

const TITLE = 'Visão geral';
const DESCRIPTION = 'Estado do bot, dos módulos e de quem está no painel.';

function moduleTone(state: string): StatusTone {
  if (state === 'RUNNING') return 'active';
  if (state === 'FAILED') return 'failed';
  return 'inactive';
}

function Indicator({
  label,
  alarm = false,
  children,
}: {
  label: string;
  alarm?: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn('text-2xl font-semibold', alarm && 'text-destructive')}>{children}</p>
      </CardContent>
    </Card>
  );
}

export function Overview() {
  const { presence } = useLive();
  const modulesTitleId = useId();
  const canManageModules = useCurrentMe().permissions.includes('core.modules.manage');
  const query = useQuery({
    queryKey: ['status'],
    queryFn: () => apiFetch<Status>('/api/status'),
    retry: false,
    refetchInterval: statusRefetchInterval,
  });
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 403) return <NoPermission />;
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <Alert variant="destructive">
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <p className="sr-only">Carregando…</p>
        <Skeleton aria-hidden="true" className="h-24 w-full" />
        <Skeleton aria-hidden="true" className="h-40 w-full" />
      </>
    );
  }
  const status = query.data;
  const running = status.modules.filter((module) => module.state === 'RUNNING').length;
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicator label="Conexão" alarm={status.connection === 'disconnected'}>
          {connectionLabel(status.connection)}
        </Indicator>
        <Indicator label="Tempo no ar">{formatUptime(status.uptimeMs)}</Indicator>
        <Indicator label="Módulos ativos">
          {running} de {status.modules.length}
        </Indicator>
        <Indicator label="No painel agora">{presence.length}</Indicator>
      </div>
      <Card role="region" aria-labelledby={modulesTitleId}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>
            <h2 id={modulesTitleId} className="text-base font-semibold">
              Módulos
            </h2>
          </CardTitle>
          {canManageModules ? (
            <Link
              to="/modulos"
              className="rounded-sm text-sm text-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Gerenciar módulos
            </Link>
          ) : null}
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {status.modules.map((module) => (
              <li key={module.id} className="flex items-center justify-between gap-4 py-2.5">
                <span className="font-mono text-sm">{module.id}</span>
                <StatusBadge tone={moduleTone(module.state)}>
                  {moduleStateLabel(module.state)}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
