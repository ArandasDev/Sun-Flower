import { useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { errorText } from '../labels.ts';
import { useOperationQuery } from '../operations.ts';

type MinLevel = 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  time: string;
  level: string;
  message: string;
  module?: string;
  fields: Record<string, string | number | boolean | null>;
}

const LIMIT = 200;

const LEVEL_OPTIONS: readonly { value: MinLevel; label: string }[] = [
  { value: 'info', label: 'Informação' },
  { value: 'warn', label: 'Aviso' },
  { value: 'error', label: 'Erro' },
  { value: 'fatal', label: 'Fatal' },
];

function levelLabel(level: string): string {
  return LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

function fieldsText(fields: LogEntry['fields']): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');
}

export function Logs() {
  const [minLevel, setMinLevel] = useState<MinLevel>('info');
  const query = useOperationQuery<{ entries: LogEntry[] }>(
    ['admin', 'logs', minLevel],
    'administration.logs.recent',
    { limit: LIMIT, minLevel },
  );
  const entries = query.data?.entries ?? [];

  return (
    <section>
      <h1>Logs</h1>
      <p className="muted">
        Os registros mais recentes do bot, do mais novo para o mais antigo. Eles não se atualizam
        sozinhos.
      </p>
      <div className="inline-form panel">
        <label>
          Nível mínimo
          <select
            value={minLevel}
            onChange={(event) => {
              setMinLevel(event.target.value as MinLevel);
            }}
          >
            {LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button button-primary"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          Atualizar
        </button>
      </div>
      <p role="alert" className="form-error">
        {query.isError ? errorText(query.error) : null}
      </p>
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {query.isSuccess && entries.length === 0 ? <p className="muted">Nenhum registro.</p> : null}
      {entries.length === 0 ? null : (
        <div className="table-scroll panel">
          <table className="log-table">
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Nível</th>
                <th scope="col">Módulo</th>
                <th scope="col">Mensagem</th>
                <th scope="col">Campos</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.time}-${String(index)}`}>
                  <td>{formatDate(entry.time)}</td>
                  <td>{levelLabel(entry.level)}</td>
                  <td>{entry.module ?? '—'}</td>
                  <td>{entry.message}</td>
                  <td className="mono">{fieldsText(entry.fields)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
