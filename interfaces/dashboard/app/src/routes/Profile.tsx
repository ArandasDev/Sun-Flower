import { levelLabel } from '../labels.ts';
import { useCurrentMe } from '../session.tsx';

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
    </section>
  );
}
