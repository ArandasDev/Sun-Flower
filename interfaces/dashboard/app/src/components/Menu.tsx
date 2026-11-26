import { NavLink } from 'react-router';
import { useCurrentMe, useLogout } from '../session.tsx';
import { PresenceList } from './PresenceList.tsx';
import { SeedMark } from './SeedMark.tsx';

const ACTION_PERMISSIONS = [
  'moderation.actions.warn',
  'moderation.actions.timeout',
  'moderation.actions.kick',
  'moderation.actions.ban',
];

export function Menu() {
  const me = useCurrentMe();
  const logout = useLogout();
  const canSeeOverview = me.level === 'developer' || me.level === 'owner';
  const canSeeCases = me.permissions.includes('moderation.cases.read');
  const canAct = ACTION_PERMISSIONS.some((permission) => me.permissions.includes(permission));
  const canManageDomains = me.permissions.includes('moderation.domains.manage');
  const canConfigure = me.permissions.includes('moderation.config.manage');
  const canManageGrants = me.permissions.includes('administration.grants.manage');
  const canManageDevelopers = me.permissions.includes('core.developers.manage');
  const canManageModules = me.permissions.includes('core.modules.manage');
  const canReadLogs = me.permissions.includes('core.logs.read');
  const canManageSessions = me.permissions.includes('core.sessions.manage');
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
        {canSeeCases ? <NavLink to="/casos">Casos</NavLink> : null}
        {canAct ? <NavLink to="/acoes">Ações</NavLink> : null}
        {canManageDomains ? <NavLink to="/dominios">Domínios</NavLink> : null}
        {canConfigure ? <NavLink to="/moderacao">Moderação</NavLink> : null}
        {canManageGrants ? <NavLink to="/permissoes">Permissões</NavLink> : null}
        {canManageDevelopers ? <NavLink to="/desenvolvedores">Desenvolvedores</NavLink> : null}
        {canManageModules ? <NavLink to="/modulos">Módulos</NavLink> : null}
        {canReadLogs ? <NavLink to="/logs">Logs</NavLink> : null}
        {canManageSessions ? <NavLink to="/sessoes">Sessões</NavLink> : null}
      </nav>
      <PresenceList />
      <button type="button" className="button button-quiet" onClick={() => logout.mutate()}>
        Sair
      </button>
      <div role="alert" className="rail-error">
        {logout.isError ? 'Não foi possível sair. Tente de novo.' : null}
      </div>
    </header>
  );
}
