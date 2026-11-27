import {
  Blocks,
  Code,
  FolderOpen,
  Gavel,
  Globe,
  KeyRound,
  LayoutDashboard,
  MonitorSmartphone,
  ScrollText,
  Settings,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { Me } from '../session.tsx';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  visible(me: Me): boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const ACTION_PERMISSIONS = [
  'moderation.actions.warn',
  'moderation.actions.timeout',
  'moderation.actions.kick',
  'moderation.actions.ban',
];

function holds(permission: string): (me: Me) => boolean {
  return (me) => me.permissions.includes(permission);
}

/** The panel screens grouped by subject (spec §3); each item keeps the permission rule it had. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Geral',
    items: [
      { to: '/', label: 'Meu perfil', icon: UserRound, visible: () => true },
      {
        to: '/visao-geral',
        label: 'Visão geral',
        icon: LayoutDashboard,
        visible: (me) => me.level === 'developer' || me.level === 'owner',
      },
    ],
  },
  {
    label: 'Moderação',
    items: [
      { to: '/casos', label: 'Casos', icon: FolderOpen, visible: holds('moderation.cases.read') },
      {
        to: '/acoes',
        label: 'Ações',
        icon: Gavel,
        visible: (me) =>
          ACTION_PERMISSIONS.some((permission) => me.permissions.includes(permission)),
      },
      {
        to: '/dominios',
        label: 'Domínios',
        icon: Globe,
        visible: holds('moderation.domains.manage'),
      },
      {
        to: '/moderacao',
        label: 'Configuração',
        icon: Settings,
        visible: holds('moderation.config.manage'),
      },
    ],
  },
  {
    label: 'Administração',
    items: [
      {
        to: '/permissoes',
        label: 'Permissões',
        icon: KeyRound,
        visible: holds('administration.grants.manage'),
      },
      {
        to: '/desenvolvedores',
        label: 'Desenvolvedores',
        icon: Code,
        visible: holds('core.developers.manage'),
      },
      { to: '/modulos', label: 'Módulos', icon: Blocks, visible: holds('core.modules.manage') },
      { to: '/logs', label: 'Logs', icon: ScrollText, visible: holds('core.logs.read') },
      {
        to: '/sessoes',
        label: 'Sessões',
        icon: MonitorSmartphone,
        visible: holds('core.sessions.manage'),
      },
    ],
  },
];

/** The menu as `me` sees it: items without permission removed, then empty groups dropped. */
export function visibleGroups(me: Me): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => item.visible(me)),
  })).filter((group) => group.items.length > 0);
}

/** Where `pathname` sits in the menu, for the header breadcrumb; `null` when it is not a menu screen. */
export function currentTrail(pathname: string): { group: string; label: string } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.to === path);
    if (item !== undefined) return { group: group.label, label: item.label };
  }
  return null;
}
