import { formatDate } from '../components/CaseDetail.tsx';
import { caseActionLabel, caseKindLabel, caseStatusLabel, levelLabel } from '../labels.ts';
import { useOperationQuery } from '../operations.ts';
import { useCurrentMe } from '../session.tsx';

interface MyCase {
  id: number;
  createdAt: string;
  kind: string;
  action: string;
  status: string;
}

function MyCases() {
  const query = useOperationQuery<{ cases: MyCase[] }>(
    ['cases', 'mine'],
    'moderation.cases.mine',
    {},
  );
  return (
    <section aria-labelledby="my-cases-title" className="my-cases">
      <h2 id="my-cases-title">Meus casos</h2>
      {query.isError ? <p role="alert">{query.error.message}</p> : null}
      {query.isPending ? <p className="muted">Carregando…</p> : null}
      {query.data?.cases.length === 0 ? (
        <p className="muted">Nenhum caso registrado com você.</p>
      ) : null}
      {query.data === undefined || query.data.cases.length === 0 ? null : (
        <ul className="case-rows">
          {query.data.cases.map((row) => (
            <li key={row.id} className="case-row case-row-static">
              <span className="case-id">Caso {row.id}</span>
              <span className="case-meta">
                {formatDate(row.createdAt)}, {caseKindLabel(row.kind, null)}
              </span>
              <span className="case-meta">
                {caseActionLabel(row.action)}, {caseStatusLabel(row.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Profile() {
  const me = useCurrentMe();
  return (
    <section>
      <h1>Meu perfil</h1>
      <div className="panel identity">
        {me.avatarUrl === null ? (
          <span className="avatar avatar-empty" aria-hidden="true" />
        ) : (
          <img className="avatar" src={me.avatarUrl} alt="" width="64" height="64" />
        )}
        <div>
          <p className="identity-name">{me.name}</p>
          <p className="identity-level">{levelLabel(me.level)}</p>
          <p className="muted">
            ID <span className="mono">{me.id}</span>
          </p>
        </div>
      </div>
      <MyCases />
    </section>
  );
}
