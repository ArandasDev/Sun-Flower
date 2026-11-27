import { formatDate } from '../components/CaseDetail.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { StatusBadge, type StatusTone } from '../components/StatusBadge.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.tsx';
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

function caseTone(status: string): StatusTone {
  if (status === 'open') return 'pending';
  if (status === 'actioned') return 'active';
  return 'inactive';
}

function MyCases() {
  const query = useOperationQuery<{ cases: MyCase[] }>(
    ['cases', 'mine'],
    'moderation.cases.mine',
    {},
  );
  return (
    <Card aria-labelledby="my-cases-title">
      <CardHeader>
        <CardTitle>
          <h2 id="my-cases-title" className="text-lg font-semibold">
            Meus casos
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
          <EmptyState title="Nenhum caso registrado com você." />
        ) : null}
        {query.data === undefined || query.data.cases.length === 0 ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Caso</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.cases.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-semibold">Caso {row.id}</TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>{caseKindLabel(row.kind, null)}</TableCell>
                  <TableCell>{caseActionLabel(row.action)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={caseTone(row.status)}>
                      {caseStatusLabel(row.status)}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function Profile() {
  const me = useCurrentMe();
  return (
    <>
      <PageHeader
        title="Meu perfil"
        description="Seus dados no servidor e os casos de moderação sobre você."
      />
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
    </>
  );
}
