import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  caseActionLabel,
  caseKindLabel,
  caseRuleLabel,
  caseStatusLabel,
  errorText,
} from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { useCurrentMe } from '../session.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

export interface CaseSummary {
  id: number;
  kind: string;
  level: string | null;
  action: string;
  status: string;
  targetUserId: string;
  rules: string[];
  createdAt: string;
}

export interface CaseFull extends Omit<CaseSummary, 'rules'> {
  actorUserId: string | null;
  channelId: string | null;
  domains: string[];
  signals: { name: string; points: number }[];
  rules: { rule: string; count: number; seconds?: number }[];
  score: number;
  reason: string;
  outcome: Record<string, string>;
  timeoutUntil: string | null;
  revertedBy: string | null;
  revertedAt: string | null;
}

interface Reverted {
  case: CaseFull;
  deletedMessage: boolean;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const DASH = '—';

type Pending = 'revert' | 'dismiss' | null;

export function CaseDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const me = useCurrentMe();
  const client = useQueryClient();
  const canAct = me.permissions.includes('moderation.cases.revert');
  const query = useOperationQuery<CaseFull>(['case', id], 'moderation.cases.view', { id });
  const [pending, setPending] = useState<Pending>(null);
  const [allowDomains, setAllowDomains] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set only after a success: the opener is about to disappear, so focus goes to the heading.
  const successFocusRef = useRef<HTMLElement | null>(null);

  // Opening a case moves focus here: on a phone this scrolls the detail into view.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['cases'] });
    void client.invalidateQueries({ queryKey: ['case', id] });
  };
  const close = (): void => {
    setPending(null);
    setAllowDomains(false);
  };
  const revert = useOperationMutation<Reverted, { id: number; allowDomains: boolean }>(
    'moderation.cases.revert',
    {
      onSuccess: (result) => {
        setNotice(
          result.deletedMessage
            ? 'Caso revertido. As mensagens apagadas não voltam.'
            : 'Caso revertido.',
        );
        successFocusRef.current = headingRef.current;
        close();
        refresh();
      },
    },
  );
  const dismiss = useOperationMutation<CaseFull, { id: number }>('moderation.cases.dismiss', {
    onSuccess: () => {
      setNotice('Caso descartado.');
      successFocusRef.current = headingRef.current;
      close();
      refresh();
    },
  });

  const header = (
    <div className="detail-head">
      <h2 ref={headingRef} tabIndex={-1}>
        Caso {id}
      </h2>
      <button type="button" className="button button-quiet" onClick={onClose}>
        Fechar
      </button>
    </div>
  );

  if (query.isError) {
    return (
      <aside className="panel detail" aria-label={`Caso ${id}`}>
        {header}
        <p role="alert">{errorText(query.error)}</p>
      </aside>
    );
  }
  if (query.isPending) {
    return (
      <aside className="panel detail" aria-label={`Caso ${id}`}>
        {header}
        <p className="muted">Carregando…</p>
      </aside>
    );
  }
  const record = query.data;
  // Mirrors the server: a case is reverted from open or actioned, dismissed only from open.
  const canRevert = record.status === 'open' || record.status === 'actioned';
  const canDismiss = record.status === 'open';
  const active = pending === 'revert' ? revert : dismiss;

  return (
    <aside className="panel detail" aria-label={`Caso ${id}`}>
      {header}
      <dl className="facts detail-facts">
        <Field label="Tipo">{caseKindLabel(record.kind, record.level)}</Field>
        <Field label="Ação">{caseActionLabel(record.action)}</Field>
        <Field label="Situação">{caseStatusLabel(record.status)}</Field>
        <Field label="Data">{formatDate(record.createdAt)}</Field>
        <Field label="Alvo">
          <span className="mono">{record.targetUserId}</span>
        </Field>
        <Field label="Moderador">
          {record.actorUserId === null ? (
            'Automático'
          ) : (
            <span className="mono">{record.actorUserId}</span>
          )}
        </Field>
        <Field label="Canal">
          {record.channelId === null ? DASH : <span className="mono">{record.channelId}</span>}
        </Field>
        <Field label="Pontuação">{record.score}</Field>
        <Field label="Motivo">{record.reason === '' ? DASH : record.reason}</Field>
        <Field label="Domínios">
          {record.domains.length === 0 ? DASH : record.domains.join(', ')}
        </Field>
        <Field label="Regras">
          {record.rules.length === 0
            ? DASH
            : record.rules.map((hit) => `${caseRuleLabel(hit.rule)} (${hit.count})`).join(', ')}
        </Field>
        <Field label="Sinais">
          {record.signals.length === 0
            ? DASH
            : record.signals.map((signal) => `${signal.name} (${signal.points})`).join(', ')}
        </Field>
        <Field label="Silenciado até">
          {record.timeoutUntil === null ? DASH : formatDate(record.timeoutUntil)}
        </Field>
        <Field label="Revertido">
          {record.revertedAt === null ? DASH : formatDate(record.revertedAt)}
        </Field>
        <Field label="Revertido por">
          {record.revertedBy === null ? DASH : <span className="mono">{record.revertedBy}</span>}
        </Field>
      </dl>
      {notice === null ? null : (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {canAct && (canRevert || canDismiss) ? (
        <div className="detail-actions">
          {canRevert ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setNotice(null);
                revert.reset();
                setPending('revert');
              }}
            >
              Reverter
            </button>
          ) : null}
          {canDismiss ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setNotice(null);
                dismiss.reset();
                setPending('dismiss');
              }}
            >
              Descartar
            </button>
          ) : null}
        </div>
      ) : null}
      {pending === null ? null : (
        <ConfirmDialog
          title={pending === 'revert' ? `Reverter o caso ${id}?` : `Descartar o caso ${id}?`}
          confirmLabel={pending === 'revert' ? 'Reverter' : 'Descartar'}
          returnFocusRef={successFocusRef}
          pending={active.isPending}
          error={active.isError ? errorText(active.error) : null}
          onCancel={close}
          onConfirm={() => {
            if (pending === 'revert') revert.mutate({ id, allowDomains });
            else dismiss.mutate({ id });
          }}
        >
          {pending === 'revert' ? (
            <>
              <p>Isso desfaz a ação no Discord. Mensagens apagadas não voltam.</p>
              {record.domains.length === 0 ? null : (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={allowDomains}
                    onChange={(event) => {
                      setAllowDomains(event.target.checked);
                    }}
                  />
                  Permitir também os domínios do caso
                </label>
              )}
            </>
          ) : (
            <p>O caso fica descartado e nada é desfeito no Discord.</p>
          )}
        </ConfirmDialog>
      )}
    </aside>
  );
}
