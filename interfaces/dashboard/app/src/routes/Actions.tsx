import { useRef, useState, type KeyboardEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { isSnowflake } from '../ids.ts';
import { NO_PERMISSION_TEXT } from '../labels.ts';
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
  const tabRefs = useRef(new Map<ActionId, HTMLButtonElement>());

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

  if (current === undefined) {
    return (
      <section>
        <h1>Ações</h1>
        <p role="alert">{NO_PERMISSION_TEXT}</p>
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
    mutation.mutate(buildInput());
  };

  return (
    <section>
      <h1>Ações</h1>
      <div role="tablist" aria-label="Ação de moderação" className="tabs">
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
            className="tab"
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
        className="panel action-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || mutation.isPending) return;
          if (current.confirmLabel === null) send();
          else setConfirming(true);
        }}
      >
        <label>
          ID do usuário
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={userId}
            aria-invalid={idInvalid}
            onChange={(event) => {
              setUserId(event.target.value);
            }}
          />
        </label>
        {idInvalid ? <p className="field-hint">Use de 17 a 20 dígitos.</p> : null}
        <label>
          Motivo
          <textarea
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
        {current.id === 'timeout' ? (
          <label>
            Minutos
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={minutes}
              aria-invalid={minutesValue === null}
              onChange={(event) => {
                setMinutes(event.target.value);
              }}
            />
          </label>
        ) : null}
        {current.id === 'timeout' && minutesValue === null ? (
          <p className="field-hint">Use de 1 a {String(MINUTES_MAX)} minutos.</p>
        ) : null}
        {current.id === 'ban' ? (
          <label>
            Dias de mensagens a apagar
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={days}
              aria-invalid={daysValue === null}
              onChange={(event) => {
                setDays(event.target.value);
              }}
            />
          </label>
        ) : null}
        {current.id === 'ban' && daysValue === null ? (
          <p className="field-hint">Use de 0 a {String(DAYS_MAX)} dias.</p>
        ) : null}
        <div className="form-actions">
          <button
            ref={submitRef}
            type="submit"
            className="button button-primary"
            disabled={!valid || mutation.isPending}
          >
            {current.submit}
          </button>
        </div>
        <div role="status" className="action-result">
          {result === null ? null : (
            <>
              <p className="notice">Caso #{result.caseId} registrado.</p>
              {result.dmFailed === true ? (
                <p className="muted">Não foi possível enviar mensagem direta.</p>
              ) : null}
            </>
          )}
        </div>
        {confirming ? null : (
          <p role="alert" className="form-error">
            {mutation.isError ? mutation.error.message : null}
          </p>
        )}
      </form>
      {confirming && current.confirmLabel !== null ? (
        <ConfirmDialog
          title={`${current.confirmLabel} este membro?`}
          confirmLabel={current.confirmLabel}
          pending={mutation.isPending}
          error={mutation.isError ? mutation.error.message : null}
          returnFocusRef={submitRef}
          onConfirm={send}
          onCancel={() => {
            setConfirming(false);
            mutation.reset();
          }}
        >
          <p>
            O usuário <span className="mono">{id}</span> será{' '}
            {current.id === 'ban' ? 'banido' : 'expulso'}. O motivo será registrado no caso.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
