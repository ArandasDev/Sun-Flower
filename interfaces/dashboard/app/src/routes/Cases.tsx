import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api.ts';
import { CaseDetail, formatDate, type CaseSummary } from '../components/CaseDetail.tsx';
import {
  caseActionLabel,
  caseKindLabel,
  caseRuleLabel,
  caseStatusLabel,
  NO_PERMISSION_TEXT,
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
  const targetInvalid = targetText !== '' && !isSnowflake(targetText);

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
    <section className="cases-layout">
      <div className="cases-list">
        <h1>Casos</h1>
        <form
          className="panel filters"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label>
            Situação
            <select
              value={status ?? ''}
              onChange={(event) => {
                setParam('situacao', event.target.value);
              }}
            >
              <option value="">Todas</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {caseStatusLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Regra
            <select
              value={rule ?? ''}
              onChange={(event) => {
                setParam('regra', event.target.value);
              }}
            >
              <option value="">Todas</option>
              {RULES.map((item) => (
                <option key={item} value={item}>
                  {caseRuleLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            ID do alvo
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={targetText}
              aria-invalid={targetInvalid}
              onChange={(event) => {
                const text = event.target.value.trim();
                setTargetText(text);
                if (text === '') setParam('alvo', null);
                else if (isSnowflake(text)) setParam('alvo', text);
              }}
            />
          </label>
          {targetInvalid ? <p className="field-hint">Use de 17 a 20 dígitos.</p> : null}
        </form>

        {query.isError ? (
          <p role="alert">
            {query.error instanceof ApiError && query.error.status === 403
              ? NO_PERMISSION_TEXT
              : query.error.message}
          </p>
        ) : null}
        {query.isPending ? <p className="muted">Carregando…</p> : null}
        {!query.isPending && !query.isError && rows.length === 0 ? (
          <p className="muted">Nenhum caso encontrado.</p>
        ) : null}
        {rows.length === 0 ? null : (
          <ul className="case-rows">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="case-row"
                  aria-current={row.id === selected ? 'true' : undefined}
                  onClick={() => {
                    setParam('caso', String(row.id), true);
                  }}
                >
                  <span className="case-id">Caso {row.id}</span>
                  <span className="case-meta">
                    {formatDate(row.createdAt)}, {caseKindLabel(row.kind, row.level)}
                  </span>
                  <span className="case-meta">
                    {caseActionLabel(row.action)}, {caseStatusLabel(row.status)}
                  </span>
                  <span className="case-meta mono">{row.targetUserId}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <button
            type="button"
            className="button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Carregar mais
          </button>
        ) : null}
      </div>
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
