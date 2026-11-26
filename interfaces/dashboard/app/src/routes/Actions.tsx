import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { isSnowflake } from '../ids.ts';
import { NO_PERMISSION_TEXT, actionErrorText } from '../labels.ts';
import { useOperationMutation } from '../operations.ts';
import { useCurrentMe } from '../session.tsx';

type ActionId = 'warn' | 'timeout' | 'kick' | 'ban';

const REASON_MAX = 512;
const MINUTES_MAX = 40320;
const DAYS_MAX = 7;

interface ActionSpec {
  id: ActionId;
  tab: string;
  submit: string;
  confirmLabel: string | null;
}

const ACTIONS: readonly ActionSpec[] = [
  { id: 'warn', tab: 'Avisar', submit: 'Enviar aviso', confirmLabel: null },
  { id: 'timeout', tab: 'Silenciar', submit: 'Aplicar silêncio', confirmLabel: null },
  { id: 'kick', tab: 'Expulsar', submit: 'Expulsar membro', confirmLabel: 'Expulsar' },
  { id: 'ban', tab: 'Banir', submit: 'Banir membro', confirmLabel: 'Banir' },
];

interface ActionResult {
  caseId: number;
  dmFailed?: boolean;
}

function parseWhole(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

export function Actions() {
  const me = useCurrentMe();
  const allowed = ACTIONS.filter((spec) =>
    me.permissions.includes(`moderation.actions.${spec.id}`),
  );
  const [selected, setSelected] = useState<ActionId | null>(null);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [days, setDays] = useState('0');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<ActionId, HTMLButtonElement>());
  const userIdId = useId();
  const reasonId = useId();
  const minutesId = useId();
  const daysId = useId();

  const current = allowed.find((spec) => spec.id === selected) ?? allowed[0];
  const mutation = useOperationMutation<ActionResult, Record<string, unknown>>(
    `moderation.actions.${current?.id ?? 'warn'}`,
    {
      onSuccess: (data) => {
        setResult(data);
        setConfirming(false);
        setUserId('');
        setReason('');
      },
    },
  );

  // The submit is disabled once the form clears, so the result takes focus.
  useEffect(() => {
    if (result !== null) resultRef.current?.focus();
  }, [result]);

  if (current === undefined) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Ações</h1>
        <p role="alert" className="text-sm text-destructive">
          {NO_PERMISSION_TEXT}
        </p>
      </section>
    );
  }

  const id = userId.trim();
  const trimmedReason = reason.trim();
  const idInvalid = id !== '' && !isSnowflake(id);
  const minutesValue = parseWhole(minutes, 1, MINUTES_MAX);
  const daysValue = parseWhole(days, 0, DAYS_MAX);
  const valid =
    isSnowflake(id) &&
    trimmedReason.length > 0 &&
    trimmedReason.length <= REASON_MAX &&
    (current.id !== 'timeout' || minutesValue !== null) &&
    (current.id !== 'ban' || daysValue !== null);

  const buildInput = (): Record<string, unknown> => ({
    userId: id,
    reason: trimmedReason,
    ...(current.id === 'timeout' ? { minutes: minutesValue } : {}),
    ...(current.id === 'ban' && daysValue !== null && daysValue > 0
      ? { deleteDays: daysValue }
      : {}),
  });

  const select = (next: ActionId): void => {
    setSelected(next);
    setResult(null);
    mutation.reset();
  };

  const onTabKey = (event: KeyboardEvent, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? allowed.length - 1
          : (index + step + allowed.length) % allowed.length;
    const next = allowed[target];
    if (next === undefined) return;
    select(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const send = (): void => {
    setResult(null);
    mutation.mutate(buildInput());
  };

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Ações</h1>
      <div
        role="tablist"
        aria-label="Ação de moderação"
        className="inline-flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1"
      >
        {allowed.map((spec, index) => (
          <button
            key={spec.id}
            ref={(node) => {
              if (node === null) tabRefs.current.delete(spec.id);
              else tabRefs.current.set(spec.id, node);
            }}
            type="button"
            role="tab"
            id={`tab-${spec.id}`}
            aria-selected={spec.id === current.id}
            aria-controls="action-panel"
            tabIndex={spec.id === current.id ? 0 : -1}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
            onClick={() => {
              select(spec.id);
            }}
            onKeyDown={(event) => {
              onTabKey(event, index);
            }}
          >
            {spec.tab}
          </button>
        ))}
      </div>
      <form
        id="action-panel"
        role="tabpanel"
        aria-labelledby={`tab-${current.id}`}
        className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || mutation.isPending) return;
          if (current.confirmLabel === null) send();
          else setConfirming(true);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={userIdId}>ID do usuário</Label>
          <Input
            id={userIdId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono"
            value={userId}
            aria-invalid={idInvalid}
            onChange={(event) => {
              setUserId(event.target.value);
            }}
          />
          {idInvalid ? <p className="text-sm text-destructive">Use de 17 a 20 dígitos.</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={reasonId}>Motivo</Label>
          <Textarea
            id={reasonId}
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </div>
        {current.id === 'timeout' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={minutesId}>Minutos</Label>
            <Input
              id={minutesId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="w-40"
              value={minutes}
              aria-invalid={minutesValue === null}
              onChange={(event) => {
                setMinutes(event.target.value);
              }}
            />
            {minutesValue === null ? (
              <p className="text-sm text-destructive">Use de 1 a {String(MINUTES_MAX)} minutos.</p>
            ) : null}
          </div>
        ) : null}
        {current.id === 'ban' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={daysId}>Dias de mensagens a apagar</Label>
            <Input
              id={daysId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="w-40"
              value={days}
              aria-invalid={daysValue === null}
              onChange={(event) => {
                setDays(event.target.value);
              }}
            />
            {daysValue === null ? (
              <p className="text-sm text-destructive">Use de 0 a {String(DAYS_MAX)} dias.</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button ref={submitRef} type="submit" disabled={!valid || mutation.isPending}>
            {current.submit}
          </Button>
        </div>
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="flex flex-col gap-1 text-sm outline-none empty:hidden"
        >
          {result === null ? null : (
            <>
              <p className="font-semibold">Caso #{result.caseId} registrado.</p>
              {result.dmFailed === true ? (
                <p className="text-muted-foreground">Não foi possível enviar mensagem direta.</p>
              ) : null}
            </>
          )}
        </div>
        {confirming ? null : (
          <p role="alert" className="text-sm font-semibold text-destructive empty:hidden">
            {mutation.isError ? actionErrorText(mutation.error) : null}
          </p>
        )}
      </form>
      {confirming && current.confirmLabel !== null ? (
        <ConfirmDialog
          title={`${current.confirmLabel} este membro?`}
          confirmLabel={current.confirmLabel}
          pending={mutation.isPending}
          error={mutation.isError ? actionErrorText(mutation.error) : null}
          onConfirm={send}
          onCancel={() => {
            setConfirming(false);
            mutation.reset();
          }}
        >
          <p>
            O usuário <span className="font-mono">{id}</span> será{' '}
            {current.id === 'ban' ? 'banido' : 'expulso'}. O motivo será registrado no caso.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
