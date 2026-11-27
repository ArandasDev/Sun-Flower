import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CaseDetail, formatDate, type CaseSummary } from '../components/CaseDetail.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardFooter, CardHeader } from '../components/ui/card.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.tsx';
import {
  caseActionLabel,
  caseKindLabel,
  caseRuleLabel,
  caseStatusLabel,
  caseStatusTone,
  errorText,
} from '../labels.ts';
import { isSnowflake } from '../ids.ts';
import { useOperationPages } from '../operations.ts';

interface CasesPage {
  cases: CaseSummary[];
  nextCursor: number | null;
}

const STATUSES = ['open', 'actioned', 'reverted', 'dismissed'] as const;
const RULES = ['flood', 'repeat', 'mentions'] as const;

/** The name the row button had when the whole row was the button, separators included. */
function rowName(row: CaseSummary): string {
  return `Caso ${String(row.id)}${formatDate(row.createdAt)}, ${caseKindLabel(row.kind, row.level)}${caseActionLabel(row.action)}, ${caseStatusLabel(row.status)}${row.targetUserId}`;
}

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

export function Cases() {
  const [params, setParams] = useSearchParams();
  const status = pick(params.get('situacao'), STATUSES);
  const rule = pick(params.get('regra'), RULES);
  const rawTarget = params.get('alvo');
  const target = rawTarget !== null && isSnowflake(rawTarget) ? rawTarget : undefined;
  const rawSelected = Number(params.get('caso'));
  const selected = Number.isInteger(rawSelected) && rawSelected > 0 ? rawSelected : null;
  const [targetText, setTargetText] = useState(target ?? '');
  // Back and forward change the URL without typing: the field follows the filter.
  const [shownTarget, setShownTarget] = useState(target);
  if (target !== shownTarget) {
    setShownTarget(target);
    setTargetText(target ?? '');
  }
  const targetInvalid = targetText !== '' && !isSnowflake(targetText);
  const statusId = useId();
  const ruleId = useId();
  const targetId = useId();

  const filters = {
    ...(status === undefined ? {} : { status }),
    ...(rule === undefined ? {} : { rule }),
    ...(target === undefined ? {} : { targetUserId: target }),
  };
  const query = useOperationPages<CasesPage>(['cases', filters], 'moderation.cases.list', filters);

  const setParam = (key: string, value: string | null, keepSelection = false): void => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
        if (!keepSelection) next.delete('caso');
        return next;
      },
      { replace: true },
    );
  };

  const rows = query.data?.pages.flatMap((page) => page.cases) ?? [];

  return (
    <>
      <PageHeader
        title="Casos"
        description="Ocorrências registradas pela moderação automática e pela equipe."
      />
      <Card>
        <CardHeader className="border-b">
          <form
            className="flex flex-wrap items-start gap-x-4 gap-y-3"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={statusId}>Situação</Label>
              <NativeSelect
                id={statusId}
                className="min-w-44"
                value={status ?? ''}
                onChange={(event) => {
                  setParam('situacao', event.target.value);
                }}
              >
                <NativeSelectOption value="">Todas</NativeSelectOption>
                {STATUSES.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {caseStatusLabel(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ruleId}>Regra</Label>
              <NativeSelect
                id={ruleId}
                className="min-w-44"
                value={rule ?? ''}
                onChange={(event) => {
                  setParam('regra', event.target.value);
                }}
              >
                <NativeSelectOption value="">Todas</NativeSelectOption>
                {RULES.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {caseRuleLabel(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={targetId}>ID do alvo</Label>
              <Input
                id={targetId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="w-56 font-mono"
                value={targetText}
                aria-invalid={targetInvalid}
                onChange={(event) => {
                  const text = event.target.value.trim();
                  setTargetText(text);
                  if (text === '') setParam('alvo', null);
                  else if (isSnowflake(text)) setParam('alvo', text);
                }}
              />
            </div>
            {targetInvalid ? (
              <p className="basis-full text-sm text-destructive">Use de 17 a 20 dígitos.</p>
            ) : null}
          </form>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {query.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorText(query.error)}</AlertDescription>
            </Alert>
          ) : null}
          {query.isPending ? (
            <div className="flex flex-col gap-2">
              <p className="sr-only">Carregando…</p>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} aria-hidden="true" className="h-10 w-full" />
              ))}
            </div>
          ) : null}
          {!query.isPending && !query.isError && rows.length === 0 ? (
            <EmptyState title="Nenhum caso encontrado." />
          ) : null}
          {rows.length === 0 ? null : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caso</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Alvo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  // The whole row opens the detail for the mouse. The button in the first cell is
                  // the keyboard path; its click bubbles up to the row.
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    data-state={row.id === selected ? 'selected' : undefined}
                    onClick={(event) => {
                      // The detail returns focus to what had it when it opened, so a click on
                      // another cell first moves focus to the row button.
                      event.currentTarget.querySelector('button')?.focus();
                      setParam('caso', String(row.id), true);
                    }}
                  >
                    <TableCell>
                      <button
                        type="button"
                        className="rounded-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        aria-label={rowName(row)}
                        aria-current={row.id === selected ? 'true' : undefined}
                      >
                        Caso {row.id}
                      </button>
                    </TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{caseKindLabel(row.kind, row.level)}</TableCell>
                    <TableCell>{caseActionLabel(row.action)}</TableCell>
                    <TableCell>
                      <StatusBadge tone={caseStatusTone(row.status)}>
                        {caseStatusLabel(row.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.targetUserId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {query.hasNextPage ? (
          <CardFooter>
            <Button
              type="button"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Carregar mais
            </Button>
          </CardFooter>
        ) : null}
      </Card>
      {selected === null ? null : (
        <CaseDetail
          key={selected}
          id={selected}
          onClose={() => {
            setParam('caso', null, true);
          }}
        />
      )}
    </>
  );
}
