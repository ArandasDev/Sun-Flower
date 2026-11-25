import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { ApiError } from '../api.ts';
import { isSnowflake } from '../ids.ts';
import { NO_PERMISSION_TEXT } from '../labels.ts';
import { runOperation, useOperationMutation, useOperationQuery } from '../operations.ts';

const CONFLICT_TEXT = 'Outra pessoa alterou esta configuração. Recarregue para ver a versão atual.';
const CONFIG_KEY = ['config', 'moderation'] as const;
const MINUTES_MAX = 40320;
const STEPS_MAX = 5;

type Json = Record<string, unknown>;

interface Snapshot {
  version: number;
  config: Json;
}

type Kind = 'int' | 'bool' | 'id' | 'ids' | 'choice';

interface Field {
  path: readonly string[];
  label: string;
  kind: Kind;
  min?: number;
  max?: number;
  options?: readonly (readonly [string, string])[];
  hint?: string;
}

interface Section {
  id: string;
  title: string;
  /** Top-level config keys this section saves. */
  tops: readonly string[];
  fields: readonly Field[];
  steps?: boolean;
}

interface Step {
  kind: string;
  minutes: string;
}

interface Draft {
  values: Record<string, string>;
  steps: Step[];
}

const PUNISHMENTS = [
  ['none', 'Nenhuma'],
  ['timeout', 'Silenciar'],
  ['kick', 'Expulsar'],
  ['ban', 'Banir'],
] as const;

const STEP_KINDS = [
  ['timeout', 'Silenciar'],
  ['kick', 'Expulsar'],
  ['ban', 'Banir'],
] as const;

function ruleFields(
  rule: 'flood' | 'repeat' | 'mentions',
  limitLabel: string,
  withSeconds: boolean,
): Field[] {
  const at = (name: string): readonly string[] => ['spam', rule, name];
  return [
    { path: at('enabled'), label: 'Regra ativa', kind: 'bool' },
    { path: at('limit'), label: limitLabel, kind: 'int', min: 2, max: 50 },
    ...(withSeconds
      ? [
          {
            path: at('seconds'),
            label: 'Janela em segundos',
            kind: 'int' as const,
            min: 2,
            max: 600,
          },
        ]
      : []),
    {
      path: at('deleteMinutes'),
      label: 'Apagar mensagens dos últimos minutos',
      kind: 'int',
      min: 0,
      max: 60,
    },
    { path: at('punishment'), label: 'Punição', kind: 'choice', options: PUNISHMENTS },
    {
      path: at('timeoutMinutes'),
      label: 'Minutos de silêncio da punição',
      kind: 'int',
      min: 1,
      max: MINUTES_MAX,
    },
  ];
}

const WEIGHTS: readonly (readonly [string, string])[] = [
  ['blocked', 'link bloqueado'],
  ['lookalike', 'domínio parecido'],
  ['masked', 'link disfarçado'],
  ['multiChannel', 'vários canais'],
  ['bait', 'termo de isca'],
  ['massMention', 'menção em massa'],
  ['newAccount', 'conta nova'],
];

const SECTIONS: readonly Section[] = [
  {
    id: 'alerts',
    title: 'Alertas',
    tops: ['alertChannelId'],
    fields: [
      {
        path: ['alertChannelId'],
        label: 'ID do canal de alertas',
        kind: 'id',
        hint: 'Deixe em branco para manter o canal atual.',
      },
    ],
  },
  {
    id: 'timeout',
    title: 'Silenciamento',
    tops: ['timeoutMinutes'],
    fields: [
      {
        path: ['timeoutMinutes'],
        label: 'Minutos de silêncio padrão',
        kind: 'int',
        min: 1,
        max: MINUTES_MAX,
      },
    ],
  },
  {
    id: 'limits',
    title: 'Limites e pesos',
    tops: ['thresholds', 'weights', 'newAccountDays', 'newMemberHours', 'multiChannel'],
    fields: [
      {
        path: ['thresholds', 'confirmed'],
        label: 'Pontos para confirmar',
        kind: 'int',
        min: 1,
        max: 1000,
      },
      {
        path: ['thresholds', 'suspicious'],
        label: 'Pontos para suspeitar',
        kind: 'int',
        min: 1,
        max: 1000,
      },
      ...WEIGHTS.map(([name, label]): Field => ({
        path: ['weights', name],
        label: `Peso de ${label}`,
        kind: 'int',
        min: 0,
        max: 1000,
      })),
      { path: ['newAccountDays'], label: 'Dias de conta nova', kind: 'int', min: 0, max: 365 },
      { path: ['newMemberHours'], label: 'Horas de membro novo', kind: 'int', min: 0, max: 720 },
      {
        path: ['multiChannel', 'channels'],
        label: 'Canais para o sinal de vários canais',
        kind: 'int',
        min: 2,
        max: 25,
      },
      {
        path: ['multiChannel', 'windowSeconds'],
        label: 'Janela de vários canais em segundos',
        kind: 'int',
        min: 10,
        max: 3600,
      },
    ],
  },
  {
    id: 'exempt',
    title: 'Cargos isentos',
    tops: ['exemptRoleIds'],
    fields: [
      {
        path: ['exemptRoleIds'],
        label: 'IDs dos cargos isentos',
        kind: 'ids',
        max: 25,
        hint: 'Um ID por linha, até 25.',
      },
    ],
  },
  {
    id: 'flood',
    title: 'Excesso de mensagens',
    tops: ['spam'],
    fields: ruleFields('flood', 'Limite de mensagens', true),
  },
  {
    id: 'repeat',
    title: 'Mensagens repetidas',
    tops: ['spam'],
    fields: ruleFields('repeat', 'Limite de repetições', true),
  },
  {
    id: 'mentions',
    title: 'Menções em massa',
    tops: ['spam'],
    fields: ruleFields('mentions', 'Limite de menções', false),
  },
  {
    id: 'escalation',
    title: 'Reincidência',
    tops: ['spam'],
    steps: true,
    fields: [
      { path: ['spam', 'escalation', 'enabled'], label: 'Reincidência ativa', kind: 'bool' },
      {
        path: ['spam', 'escalation', 'windowHours'],
        label: 'Janela em horas',
        kind: 'int',
        min: 1,
        max: 168,
      },
    ],
  },
  {
    id: 'ignored',
    title: 'Canais ignorados',
    tops: ['spam'],
    fields: [
      {
        path: ['spam', 'ignoredChannelIds'],
        label: 'IDs dos canais ignorados',
        kind: 'ids',
        max: 25,
        hint: 'Um ID por linha, até 25.',
      },
    ],
  },
];

const keyOf = (field: Field): string => field.path.join('.');

function getPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Json)[key];
  }
  return current;
}

/** Sets the value at `path`; `undefined` removes the key. */
function setPath(root: Json, path: readonly string[], value: unknown): void {
  let current = root;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (typeof next !== 'object' || next === null) current[key] = {};
    current = current[key] as Json;
  }
  const last = path.at(-1);
  if (last === undefined) return;
  if (value === undefined) delete current[last];
  else current[last] = value;
}

function toDraft(config: Json): Draft {
  const values: Record<string, string> = {};
  for (const section of SECTIONS) {
    for (const field of section.fields) {
      const value = getPath(config, field.path);
      values[keyOf(field)] =
        field.kind === 'ids'
          ? Array.isArray(value)
            ? value.join('\n')
            : ''
          : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
    }
  }
  const steps = getPath(config, ['spam', 'escalation', 'steps']);
  return {
    values,
    steps: Array.isArray(steps)
      ? steps.map((step: unknown) => {
          const item = (typeof step === 'object' && step !== null ? step : {}) as Json;
          return {
            kind: typeof item['kind'] === 'string' ? item['kind'] : 'timeout',
            minutes: typeof item['minutes'] === 'number' ? String(item['minutes']) : '10',
          };
        })
      : [],
  };
}

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function parseField(field: Field, text: string): Parsed {
  switch (field.kind) {
    case 'bool':
      return { ok: true, value: text === 'true' };
    case 'choice':
      return { ok: true, value: text };
    case 'int': {
      const min = field.min ?? 0;
      const max = field.max ?? Number.MAX_SAFE_INTEGER;
      const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
      return value >= min && value <= max
        ? { ok: true, value }
        : { ok: false, message: `Use de ${String(min)} a ${String(max)}.` };
    }
    case 'id': {
      const value = text.trim();
      if (value === '') return { ok: true, value: undefined };
      return isSnowflake(value)
        ? { ok: true, value }
        : { ok: false, message: 'Use de 17 a 20 dígitos.' };
    }
    case 'ids': {
      const items = text.split(/[\s,;]+/).filter((item) => item !== '');
      if (items.length > (field.max ?? 25)) {
        return { ok: false, message: `Use no máximo ${String(field.max ?? 25)} IDs.` };
      }
      return items.every(isSnowflake)
        ? { ok: true, value: [...new Set(items)] }
        : { ok: false, message: 'Cada ID deve ter de 17 a 20 dígitos.' };
    }
  }
}

function parseSteps(steps: Step[]): Parsed {
  if (steps.length < 1 || steps.length > STEPS_MAX) {
    return { ok: false, message: `Use de 1 a ${String(STEPS_MAX)} etapas.` };
  }
  const parsed: Json[] = [];
  for (const step of steps) {
    if (step.kind !== 'timeout') {
      parsed.push({ kind: step.kind });
      continue;
    }
    const minutes = /^\d+$/.test(step.minutes.trim()) ? Number(step.minutes.trim()) : Number.NaN;
    if (!(minutes >= 1 && minutes <= MINUTES_MAX)) {
      return { ok: false, message: `Use de 1 a ${String(MINUTES_MAX)} minutos em cada etapa.` };
    }
    parsed.push({ kind: 'timeout', minutes });
  }
  return { ok: true, value: parsed };
}

/** Field errors by key (and `steps`) for one section. */
function sectionErrors(section: Section, draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of section.fields) {
    const parsed = parseField(field, draft.values[keyOf(field)] ?? '');
    if (!parsed.ok) errors[keyOf(field)] = parsed.message;
  }
  if (section.steps === true) {
    const parsed = parseSteps(draft.steps);
    if (!parsed.ok) errors['steps'] = parsed.message;
  }
  return errors;
}

/** Only this section's top-level keys; the rest of a shared key comes from the loaded snapshot. */
function buildChanges(section: Section, base: Json, draft: Draft): Json {
  const next = structuredClone(base);
  for (const field of section.fields) {
    const parsed = parseField(field, draft.values[keyOf(field)] ?? '');
    if (parsed.ok) setPath(next, field.path, parsed.value);
  }
  if (section.steps === true) {
    const parsed = parseSteps(draft.steps);
    if (parsed.ok) setPath(next, ['spam', 'escalation', 'steps'], parsed.value);
  }
  const changes: Json = {};
  for (const top of section.tops) {
    if (next[top] !== undefined) changes[top] = next[top];
  }
  return changes;
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function sectionDirty(section: Section, draft: Draft, base: Draft): boolean {
  return (
    section.fields.some((field) => draft.values[keyOf(field)] !== base.values[keyOf(field)]) ||
    (section.steps === true && JSON.stringify(draft.steps) !== JSON.stringify(base.steps))
  );
}

interface FieldInputProps {
  field: Field;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}

function FieldInput({ field, value, error, onChange }: FieldInputProps) {
  const hintId = useId();
  const describedBy = field.hint === undefined && error === undefined ? undefined : hintId;
  if (field.kind === 'bool') {
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(event) => {
            onChange(String(event.target.checked));
          }}
        />
        {field.label}
      </label>
    );
  }
  const hint = (
    <>
      {error === undefined ? null : <span className="field-hint">{error}</span>}
      {field.hint === undefined ? null : <span className="muted">{field.hint}</span>}
    </>
  );
  return (
    <div className="field">
      <label>
        {field.label}
        {field.kind === 'choice' ? (
          <select
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          >
            {field.options?.map(([optionValue, label]) => (
              <option key={optionValue} value={optionValue}>
                {label}
              </option>
            ))}
          </select>
        ) : field.kind === 'ids' ? (
          <textarea
            rows={3}
            value={value}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        ) : (
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        )}
      </label>
      <span id={hintId} className="field-notes">
        {hint}
      </span>
    </div>
  );
}

interface StepsEditorProps {
  steps: Step[];
  error: string | undefined;
  onChange: (steps: Step[]) => void;
}

function StepsEditor({ steps, error, onChange }: StepsEditorProps) {
  const update = (index: number, patch: Partial<Step>): void => {
    onChange(steps.map((step, at) => (at === index ? { ...step, ...patch } : step)));
  };
  return (
    <fieldset className="steps">
      <legend>Etapas, da primeira à última ocorrência</legend>
      {steps.map((step, index) => (
        // The list is edited by position, so the index is the identity of a row.
        <div className="step-row" key={index}>
          <label className="field">
            {`Etapa ${String(index + 1)}, ação`}
            <select
              value={step.kind}
              onChange={(event) => {
                update(index, { kind: event.target.value });
              }}
            >
              {STEP_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {step.kind === 'timeout' ? (
            <label className="field">
              {`Etapa ${String(index + 1)}, minutos`}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={step.minutes}
                onChange={(event) => {
                  update(index, { minutes: event.target.value });
                }}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="button button-quiet"
            disabled={steps.length <= 1}
            onClick={() => {
              onChange(steps.filter((_, at) => at !== index));
            }}
          >
            {`Remover etapa ${String(index + 1)}`}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button"
        disabled={steps.length >= STEPS_MAX}
        onClick={() => {
          onChange([...steps, { kind: 'timeout', minutes: '10' }]);
        }}
      >
        Adicionar etapa
      </button>
      {error === undefined ? null : <p className="field-hint">{error}</p>}
    </fieldset>
  );
}

interface FormProps {
  latest: Snapshot;
  reload: () => Promise<Snapshot | undefined>;
}

function ConfigForm({ latest, reload }: FormProps) {
  const client = useQueryClient();
  const [base, setBase] = useState<Snapshot>(latest);
  const [draft, setDraft] = useState<Draft>(() => toDraft(latest.config));
  const [conflict, setConflict] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const baseDraft = useMemo(() => toDraft(base.config), [base]);
  const dirty = SECTIONS.some((section) => sectionDirty(section, draft, baseDraft));
  const save = useOperationMutation<Snapshot, { expectedVersion: number; changes: Json }>(
    'moderation.config.update',
  );

  const adopt = (snapshot: Snapshot): void => {
    setBase(snapshot);
    setDraft(toDraft(snapshot.config));
    setConflict(false);
    setProblems({});
    setSaved(null);
  };

  // Someone else's change that arrives while nothing is being edited is taken silently. Only a
  // newer version counts: right after our own save the cache can still hold the older one.
  if (latest.version > base.version && !dirty) adopt(latest);
  const stale = latest.version > base.version;

  const edit = (section: Section, patch: (current: Draft) => Draft): void => {
    setDraft(patch);
    setSaved(null);
    setProblems((current) => withoutKey(current, section.id));
  };

  const submit = (section: Section): void => {
    setSaved(null);
    setProblems((current) => withoutKey(current, section.id));
    save.mutate(
      { expectedVersion: base.version, changes: buildChanges(section, base.config, draft) },
      {
        onSuccess: (snapshot) => {
          client.setQueryData(CONFIG_KEY, snapshot);
          const fresh = toDraft(snapshot.config);
          setBase(snapshot);
          setDraft((current) => ({
            values: {
              ...current.values,
              ...Object.fromEntries(
                section.fields.map((field) => [keyOf(field), fresh.values[keyOf(field)] ?? '']),
              ),
            },
            steps: section.steps === true ? fresh.steps : current.steps,
          }));
          setSaved(section.id);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            setConflict(true);
          } else {
            const message =
              error instanceof ApiError && error.status === 403
                ? NO_PERMISSION_TEXT
                : error.message;
            setProblems((current) => ({ ...current, [section.id]: message }));
          }
        },
      },
    );
  };

  const doReload = async (): Promise<void> => {
    try {
      const fresh = await reload();
      if (fresh !== undefined) adopt(fresh);
    } catch {
      // The notice and its button stay, so the person can try again.
    }
  };

  return (
    <>
      <div role="alert" className="conflict">
        {conflict || stale ? (
          <>
            <p>{CONFLICT_TEXT}</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                void doReload();
              }}
            >
              Recarregar
            </button>
          </>
        ) : null}
      </div>
      {SECTIONS.map((section) => (
        <SectionForm
          key={section.id}
          section={section}
          draft={draft}
          pending={save.isPending}
          problem={problems[section.id]}
          saved={saved === section.id}
          onEdit={(patch) => {
            edit(section, patch);
          }}
          onSubmit={() => {
            submit(section);
          }}
        />
      ))}
    </>
  );
}

interface SectionProps {
  section: Section;
  draft: Draft;
  pending: boolean;
  problem: string | undefined;
  saved: boolean;
  onEdit: (patch: (current: Draft) => Draft) => void;
  onSubmit: () => void;
}

function SectionForm({ section, draft, pending, problem, saved, onEdit, onSubmit }: SectionProps) {
  const titleId = useId();
  const errors = sectionErrors(section, draft);
  const emptyAlert =
    section.id === 'alerts' && (draft.values['alertChannelId'] ?? '').trim() === '';
  return (
    <section className="panel config-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{section.title}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (Object.keys(errors).length === 0 && !emptyAlert && !pending) onSubmit();
        }}
      >
        <div className="config-fields">
          {section.fields.map((field) => (
            <FieldInput
              key={keyOf(field)}
              field={field}
              value={draft.values[keyOf(field)] ?? ''}
              error={errors[keyOf(field)]}
              onChange={(value) => {
                onEdit((current) => ({
                  ...current,
                  values: { ...current.values, [keyOf(field)]: value },
                }));
              }}
            />
          ))}
        </div>
        {section.steps === true ? (
          <StepsEditor
            steps={draft.steps}
            error={errors['steps']}
            onChange={(steps) => {
              onEdit((current) => ({ ...current, steps }));
            }}
          />
        ) : null}
        <div className="form-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={pending || emptyAlert || Object.keys(errors).length > 0}
          >
            Salvar
          </button>
          <span role="status" className="notice-inline">
            {saved ? 'Salvo.' : null}
          </span>
        </div>
        <p role="alert" className="form-error">
          {problem}
        </p>
      </form>
    </section>
  );
}

export function ModerationConfig() {
  const query = useOperationQuery<Snapshot>(CONFIG_KEY, 'moderation.config.view', {});
  const client = useQueryClient();
  const reload = async (): Promise<Snapshot | undefined> => {
    const fresh = await client.fetchQuery({
      queryKey: CONFIG_KEY,
      queryFn: () => runOperation<Snapshot>('moderation.config.view', {}),
      staleTime: 0,
    });
    return fresh;
  };
  return (
    <section>
      <h1>Moderação</h1>
      {query.isError ? (
        <p role="alert">
          {query.error instanceof ApiError && query.error.status === 403
            ? NO_PERMISSION_TEXT
            : query.error.message}
        </p>
      ) : null}
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {query.data === undefined ? null : <ConfigForm latest={query.data} reload={reload} />}
    </section>
  );
}
