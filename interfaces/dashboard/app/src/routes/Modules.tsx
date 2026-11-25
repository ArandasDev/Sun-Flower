import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';

interface ModuleEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  state: string;
  enabled: boolean;
  canDisable: boolean;
  dependencies: string[];
  dependents: string[];
  failedAt?: string;
}

interface SetEnabledInput {
  moduleId: string;
  enabled: boolean;
}

function situation(entry: ModuleEntry): string {
  if (entry.state === 'RUNNING') return 'Ligado';
  if (!entry.enabled) return 'Desligado';
  if (entry.state === 'FAILED') {
    return entry.failedAt === undefined
      ? 'Falhou ao iniciar'
      : `Falhou ao iniciar (${formatDate(entry.failedAt)})`;
  }
  return 'Em transição';
}

export function Modules() {
  const client = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [disabling, setDisabling] = useState<ModuleEntry | null>(null);
  const query = useOperationQuery<{ modules: ModuleEntry[] }>(
    ['admin', 'modules'],
    'administration.modules.list',
    {},
  );
  // Reloads after a failure too: a failed enable still stores the flag, and the row shows FAILED.
  const toggle = useOperationMutation<unknown, SetEnabledInput>(
    'administration.modules.set-enabled',
    {
      onSuccess: () => {
        setDisabling(null);
      },
      onSettled: () => {
        void client.invalidateQueries({ queryKey: ['admin', 'modules'] });
      },
    },
  );
  const modules = query.data?.modules ?? [];
  const pageError =
    disabling === null && toggle.error !== null ? toggle.error : query.isError ? query.error : null;

  return (
    <section>
      <h1 ref={headingRef} tabIndex={-1}>
        Módulos
      </h1>
      <p className="muted">
        Ligue ou desligue módulos do bot sem reiniciá-lo. A escolha vale também depois de um
        reinício.
      </p>
      <p role="alert" className="form-error">
        {pageError === null ? null : errorText(pageError)}
      </p>
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {modules.length === 0 ? null : (
        <ul className="domain-rows panel">
          {modules.map((entry) => (
            <li key={entry.id}>
              <span>
                <strong>{entry.name}</strong>
                <span className="muted"> versão {entry.version}</span>
                <span className="row-line">{situation(entry)}</span>
                {entry.description === '' ? null : (
                  <span className="row-line muted">{entry.description}</span>
                )}
                {entry.dependencies.length === 0 ? null : (
                  <span className="row-line muted">
                    Depende de: {entry.dependencies.join(', ')}
                  </span>
                )}
                {entry.canDisable || entry.state !== 'RUNNING' ? null : (
                  <span className="row-line muted">Não pode ser desligado.</span>
                )}
              </span>
              {entry.state === 'RUNNING' ? (
                entry.canDisable ? (
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={toggle.isPending}
                    onClick={() => {
                      toggle.reset();
                      setDisabling(entry);
                    }}
                  >
                    Desligar
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={toggle.isPending}
                  onClick={() => {
                    toggle.reset();
                    toggle.mutate({ moduleId: entry.id, enabled: true });
                  }}
                >
                  Ligar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {disabling === null ? null : (
        <ConfirmDialog
          title="Desligar módulo"
          confirmLabel="Desligar"
          pending={toggle.isPending}
          error={toggle.error === null ? null : errorText(toggle.error)}
          returnFocusRef={headingRef}
          onConfirm={() => {
            toggle.mutate({ moduleId: disabling.id, enabled: false });
          }}
          onCancel={() => {
            toggle.reset();
            setDisabling(null);
          }}
        >
          <p>
            Desligar o módulo <strong>{disabling.name}</strong>? Os comandos e as funções dele param
            até alguém ligá-lo de novo.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
