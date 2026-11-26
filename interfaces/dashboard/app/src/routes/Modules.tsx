import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { formatDate } from '../components/CaseDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { Switch } from '../components/ui/switch.tsx';
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

function situationVariant(entry: ModuleEntry): 'secondary' | 'destructive' {
  return entry.enabled && entry.state === 'FAILED' ? 'destructive' : 'secondary';
}

export function Modules() {
  const client = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const watchFocus = useRef(false);
  const [disabling, setDisabling] = useState<ModuleEntry | null>(null);
  const query = useOperationQuery<{ modules: ModuleEntry[] }>(
    ['admin', 'modules'],
    'administration.modules.list',
    {},
    { refetchOnFocus: false },
  );
  // Reloads after a failure too: a failed enable still stores the flag, and the row shows FAILED.
  const toggle = useOperationMutation<unknown, SetEnabledInput>(
    'administration.modules.set-enabled',
    {
      onSuccess: () => {
        setDisabling(null);
      },
      onSettled: async () => {
        await client.invalidateQueries({ queryKey: ['admin', 'modules'] });
      },
    },
  );
  // After Ligar settles and the list reloads, its button may be gone (the row is now running and
  // cannot be switched off): move focus to the heading instead of letting it fall to the page.
  useEffect(() => {
    if (toggle.isPending || query.isFetching || !watchFocus.current) return;
    watchFocus.current = false;
    if (document.activeElement === document.body)
      headingRef.current?.focus({ preventScroll: true });
  }, [toggle.isPending, query.isFetching, query.data]);
  const modules = query.data?.modules ?? [];
  const pageError =
    disabling === null && toggle.error !== null ? toggle.error : query.isError ? query.error : null;

  return (
    <section className="flex flex-col gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        Módulos
      </h1>
      <p className="text-sm text-muted-foreground">
        Ligue ou desligue módulos do bot sem reiniciá-lo. A escolha vale também depois de um
        reinício.
      </p>
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {pageError === null ? null : errorText(pageError)}
      </p>
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <p className="sr-only">Carregando…</p>
          {[0, 1].map((index) => (
            <Skeleton key={index} aria-hidden="true" className="h-9 w-full" />
          ))}
        </div>
      ) : null}
      {modules.length === 0 ? null : (
        <Card>
          <CardContent>
            <ul className="flex flex-col divide-y rounded-md border">
              {modules.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-3 py-3">
                  <span className="flex min-w-0 flex-col gap-1 text-sm">
                    <span>
                      <strong className="font-semibold">{entry.name}</strong>
                      <span className="text-muted-foreground"> versão {entry.version}</span>
                    </span>
                    <Badge variant={situationVariant(entry)}>{situation(entry)}</Badge>
                    {entry.description === '' ? null : (
                      <span className="text-muted-foreground">{entry.description}</span>
                    )}
                    {entry.dependencies.length === 0 ? null : (
                      <span className="text-muted-foreground">
                        Depende de: {entry.dependencies.join(', ')}
                      </span>
                    )}
                    {entry.canDisable || entry.state !== 'RUNNING' ? null : (
                      <span className="text-muted-foreground">Não pode ser desligado.</span>
                    )}
                  </span>
                  {entry.state === 'RUNNING' ? (
                    entry.canDisable ? (
                      <Switch
                        checked
                        aria-label="Desligar"
                        disabled={toggle.isPending}
                        onCheckedChange={() => {
                          toggle.reset();
                          setDisabling(entry);
                        }}
                      />
                    ) : null
                  ) : (
                    <Switch
                      checked={false}
                      aria-label="Ligar"
                      disabled={toggle.isPending}
                      onCheckedChange={() => {
                        toggle.reset();
                        watchFocus.current = true;
                        toggle.mutate({ moduleId: entry.id, enabled: true });
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
