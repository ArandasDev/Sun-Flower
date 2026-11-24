import { NavLink } from 'react-router';
import { useCurrentMe, useLogout } from '../session.tsx';
import { SeedMark } from './SeedMark.tsx';

export function Menu() {
  const me = useCurrentMe();
  const logout = useLogout();
  const canSeeOverview = me.level === 'developer' || me.level === 'owner';
  return (
    <header className="rail">
      <div className="brand">
        <SeedMark size={32} />
        <span className="brand-name">Sun Flower</span>
      </div>
      <nav aria-label="Principal" className="nav">
        <NavLink to="/" end>
          Meu perfil
        </NavLink>
        {canSeeOverview ? <NavLink to="/visao-geral">Visão geral</NavLink> : null}
      </nav>
      <button type="button" className="button button-quiet" onClick={() => logout.mutate()}>
        Sair
      </button>
      <div role="alert" className="rail-error">
        {logout.isError ? 'Não foi possível sair. Tente de novo.' : null}
      </div>
    </header>
  );
}
