import { formatDate } from '../components/CaseDetail.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { caseActionLabel, caseKindLabel, caseStatusLabel, levelLabel } from '../labels.ts';
import { useOperationQuery } from '../operations.ts';
import { useCurrentMe } from '../session.tsx';

interface MyCase {
  id: number;
  createdAt: string;
  kind: string;
  action: string;
  status: string;
}

function MyCases() {
  const query = useOperationQuery<{ cases: MyCase[] }>(
    ['cases', 'mine'],
    'moderation.cases.mine',
    {},
  );
  return (
    <section aria-labelledby="my-cases-title" className="flex flex-col gap-3">
      <h2 id="my-cases-title" className="text-lg font-semibold">
        Meus casos
      </h2>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <p className="sr-only">Carregando…</p>
          {[0, 1].map((index) => (
            <Skeleton key={index} aria-hidden="true" className="h-12 w-full" />
          ))}
        </div>
      ) : null}
      {query.data?.cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum caso registrado com você.</p>
      ) : null}
      {query.data === undefined || query.data.cases.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {query.data.cases.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm"
            >
              <span className="font-semibold">Caso {row.id}</span>
              <span className="text-muted-foreground">
                {formatDate(row.createdAt)}, {caseKindLabel(row.kind, null)}
              </span>
              <span className="text-muted-foreground">{caseActionLabel(row.action)}</span>
              <Badge variant="secondary">{caseStatusLabel(row.status)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Profile() {
  const me = useCurrentMe();
  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Meu perfil</h1>
      <Card>
        <CardContent className="flex items-center gap-4">
          {me.avatarUrl === null ? (
            <span className="size-16 shrink-0 rounded-full bg-muted" aria-hidden="true" />
          ) : (
            <img
              className="size-16 shrink-0 rounded-full object-cover"
              src={me.avatarUrl}
              alt=""
              width="64"
              height="64"
            />
          )}
          <div className="flex min-w-0 flex-col items-start gap-1">
            <p className="text-lg font-semibold">{me.name}</p>
            <Badge variant="outline">{levelLabel(me.level)}</Badge>
            <p className="text-sm text-muted-foreground">
              ID <span className="font-mono">{me.id}</span>
            </p>
          </div>
        </CardContent>
      </Card>
      <MyCases />
    </section>
  );
}
