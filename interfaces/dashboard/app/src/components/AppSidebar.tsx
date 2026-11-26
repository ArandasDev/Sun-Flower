import { NavLink, useLocation } from 'react-router';
import { useCurrentMe } from '../session.tsx';
import { AccountMenu } from './AccountMenu.tsx';
import { visibleGroups } from './navigation.ts';
import { PresenceList } from './PresenceList.tsx';
import { SeedMark } from './SeedMark.tsx';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from './ui/sidebar.tsx';

/**
 * Idle items get the sidebar text colour explicitly, so the old `a { color }` rule never
 * applies. Active: amber with zinc-950 passes AA; link-coloured text on sidebar-accent would not.
 */
const ITEM_COLOURS =
  'text-sidebar-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary/90 data-[active=true]:hover:text-primary-foreground';

/** The grouped menu; collapsed it shows icons with the name as a tip, on phones it is a drawer. */
export function AppSidebar() {
  const me = useCurrentMe();
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 overflow-hidden">
          <SeedMark size={32} />
          <span className="truncate text-lg font-bold group-data-[collapsible=icon]:hidden">
            Sun Flower
          </span>
        </div>
      </SidebarHeader>
      <nav aria-label="Principal" className="flex min-h-0 flex-1 flex-col">
        <SidebarContent>
          {visibleGroups(me).map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.to}
                        tooltip={item.label}
                        className={ITEM_COLOURS}
                      >
                        <NavLink
                          to={item.to}
                          end
                          onClick={() => {
                            if (isMobile) setOpenMobile(false);
                          }}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </nav>
      <SidebarFooter>
        <div className="group-data-[collapsible=icon]:hidden">
          <PresenceList />
        </div>
        <AccountMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
