import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import {
  caseActionLabel,
  caseKindLabel,
  caseRuleLabel,
  caseStatusLabel,
  errorText,
} from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';
import { notify } from '../toast.ts';
import { useCurrentMe } from '../session.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Label } from './ui/label.tsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet.tsx';
import { Skeleton } from './ui/skeleton.tsx';

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
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>;
}

const DASH = '—';

type Pending = 'revert' | 'dismiss' | null;

/** The case detail in a Sheet on the right; Escape and "Fechar" call `onClose`. */
export function CaseDetail({ id, onClose }: { id: number; onClose: () => void }) {
  // There is no Radix Trigger (the URL opens the case), so the case row that had focus when
  // the detail opened is kept here to give focus back on close.
  const [opener] = useState(() => document.activeElement);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="w-full gap-0 overflow-y-auto sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        }}
      >
        <CaseBody id={id} />
      </SheetContent>
    </Sheet>
  );
}

function CaseBody({ id }: { id: number }) {
  const me = useCurrentMe();
  const client = useQueryClient();
  const canAct = me.permissions.includes('moderation.cases.revert');
  const query = useOperationQuery<CaseFull>(['case', id], 'moderation.cases.view', { id });
  const [pending, setPending] = useState<Pending>(null);
  const [allowDomains, setAllowDomains] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const domainsId = useId();
  // Set only after a success: the opener is about to disappear, so focus goes to the heading.
  const successFocusRef = useRef<HTMLElement | null>(null);

  // Opening a case moves focus to its heading, inside the Sheet's focus trap.
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
        notify('Caso revertido.');
        successFocusRef.current = headingRef.current;
        close();
        refresh();
      },
    },
  );
  const dismiss = useOperationMutation<CaseFull, { id: number }>('moderation.cases.dismiss', {
    onSuccess: () => {
      setNotice('Caso descartado.');
      notify('Caso descartado.');
      successFocusRef.current = headingRef.current;
      close();
      refresh();
    },
  });

  const header = (
    <SheetHeader className="border-b pr-12">
      <SheetTitle ref={headingRef} tabIndex={-1} className="text-lg outline-none">
        Caso {id}
      </SheetTitle>
    </SheetHeader>
  );

  if (query.isError) {
    return (
      <>
        {header}
        <p role="alert" className="p-4 text-sm text-destructive">
          {errorText(query.error)}
        </p>
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3 p-4">
          <p className="sr-only">Carregando…</p>
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} aria-hidden="true" className="h-8 w-full" />
          ))}
        </div>
      </>
    );
  }
  const record = query.data;
  // Mirrors the server: a case is reverted from open or actioned, dismissed only from open.
  const canRevert = record.status === 'open' || record.status === 'actioned';
  const canDismiss = record.status === 'open';
  const active = pending === 'revert' ? revert : dismiss;

  return (
    <>
      {header}
      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tipo">{caseKindLabel(record.kind, record.level)}</Field>
          <Field label="Ação">{caseActionLabel(record.action)}</Field>
          <Field label="Situação">
            <Badge variant="secondary">{caseStatusLabel(record.status)}</Badge>
          </Field>
          <Field label="Data">{formatDate(record.createdAt)}</Field>
          <Field label="Alvo">
            <Mono>{record.targetUserId}</Mono>
          </Field>
          <Field label="Moderador">
            {record.actorUserId === null ? 'Automático' : <Mono>{record.actorUserId}</Mono>}
          </Field>
          <Field label="Canal">
            {record.channelId === null ? DASH : <Mono>{record.channelId}</Mono>}
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
            {record.revertedBy === null ? DASH : <Mono>{record.revertedBy}</Mono>}
          </Field>
        </dl>
        {notice === null ? null : (
          <p className="text-sm font-semibold" role="status">
            {notice}
          </p>
        )}
        {canAct && (canRevert || canDismiss) ? (
          <div className="flex flex-wrap gap-2">
            {canRevert ? (
              <Button
                type="button"
                onClick={() => {
                  setNotice(null);
                  revert.reset();
                  setPending('revert');
                }}
              >
                Reverter
              </Button>
            ) : null}
            {canDismiss ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNotice(null);
                  dismiss.reset();
                  setPending('dismiss');
                }}
              >
                Descartar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
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
                <div className="flex items-center gap-2">
                  <input
                    id={domainsId}
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={allowDomains}
                    onChange={(event) => {
                      setAllowDomains(event.target.checked);
                    }}
                  />
                  <Label htmlFor={domainsId} className="font-normal">
                    Permitir também os domínios do caso
                  </Label>
                </div>
              )}
            </>
          ) : (
            <p>O caso fica descartado e nada é desfeito no Discord.</p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
