import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CaseDetail, formatDate, type CaseSummary } from '../components/CaseDetail.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import {
  caseActionLabel,
  caseKindLabel,
  caseRuleLabel,
  caseStatusLabel,
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
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Casos</h1>
      <form
        className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-xl border bg-card p-4"
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

      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(query.error)}
        </p>
      ) : null}
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <p className="sr-only">Carregando…</p>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} aria-hidden="true" className="h-16 w-full" />
          ))}
        </div>
      ) : null}
      {!query.isPending && !query.isError && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum caso encontrado.</p>
      ) : null}
      {rows.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-3 text-left text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=true]:border-primary"
                aria-current={row.id === selected ? 'true' : undefined}
                onClick={() => {
                  setParam('caso', String(row.id), true);
                }}
              >
                <span className="font-semibold">Caso {row.id}</span>
                <span className="text-muted-foreground">
                  {formatDate(row.createdAt)}, {caseKindLabel(row.kind, row.level)}
                </span>
                <span className="text-muted-foreground">
                  {caseActionLabel(row.action)},{' '}
                  <Badge variant="secondary">{caseStatusLabel(row.status)}</Badge>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{row.targetUserId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Carregar mais
        </Button>
      ) : null}
      {selected === null ? null : (
        <CaseDetail
          key={selected}
          id={selected}
          onClose={() => {
            setParam('caso', null, true);
          }}
        />
      )}
    </section>
  );
}
