import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { errorText } from '../labels.ts';
import { useOperationMutation, useOperationQuery } from '../operations.ts';

type ListName = 'block' | 'allow';

function DomainList({ list, title }: { list: ListName; title: string }) {
  const client = useQueryClient();
  const titleId = useId();
  const [text, setText] = useState('');
  const query = useOperationQuery<{ domains: string[] }>(
    ['domains', list],
    'moderation.domains.list',
    { list },
  );
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['domains'] });
  };
  const add = useOperationMutation<unknown, { domain: string }>(`moderation.domains.${list}`, {
    onSuccess: () => {
      setText('');
      refresh();
    },
  });
  const remove = useOperationMutation<unknown, { domain: string }>('moderation.domains.remove', {
    onSuccess: refresh,
  });
  const error = add.error ?? remove.error ?? (query.isError ? query.error : null);
  const domains = query.data?.domains ?? [];

  return (
    <section className="panel domain-list" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const domain = text.trim();
          if (domain !== '') add.mutate({ domain });
        }}
      >
        <label>
          Adicionar domínio
          <input
            type="text"
            autoComplete="off"
            maxLength={253}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={add.isPending || text.trim() === ''}
        >
          Adicionar
        </button>
      </form>
      <p role="alert" className="form-error">
        {error === null ? null : errorText(error)}
      </p>
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {query.isSuccess && domains.length === 0 ? (
        <p className="muted">Nenhum domínio nesta lista.</p>
      ) : null}
      {domains.length === 0 ? null : (
        <ul className="domain-rows">
          {domains.map((domain, index) => (
            <li key={domain}>
              <span className="mono" id={`${titleId}-d${String(index)}`}>
                {domain}
              </span>
              <button
                type="button"
                className="button button-quiet"
                aria-describedby={`${titleId}-d${String(index)}`}
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate({ domain });
                }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Domains() {
  return (
    <section>
      <h1>Domínios</h1>
      <p className="muted">
        Domínios bloqueados contam como sinal forte de golpe. Links para domínios permitidos são
        ignorados na análise.
      </p>
      <div className="domain-grid">
        <DomainList list="block" title="Bloqueados" />
        <DomainList list="allow" title="Permitidos" />
      </div>
    </section>
  );
}
