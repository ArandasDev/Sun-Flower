import { ChevronsUpDown, LogOut } from 'lucide-react';
import { useId } from 'react';
import { useCurrentMe, useLogout } from '../session.tsx';
import { useTheme, type ThemeChoice } from '../theme.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from './ui/sidebar.tsx';

const THEMES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
];

function isThemeChoice(value: string): value is ThemeChoice {
  return THEMES.some((option) => option.value === value);
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url === null) {
    return (
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
      >
        {[...name][0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return <img className="size-8 shrink-0 rounded-full object-cover" src={url} alt="" />;
}

/**
 * The signed-in person at the foot of the menu: theme choice and sign-out.
 * The only `useTheme` consumer, since that hook keeps its state per instance.
 */
export function AccountMenu() {
  const me = useCurrentMe();
  const logout = useLogout();
  const theme = useTheme();
  const { isMobile } = useSidebar();
  const themeLabelId = useId();
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                aria-label={`Conta de ${me.name}`}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar name={me.name} url={me.avatarUrl} />
                <span className="min-w-0 flex-1 truncate font-medium">{me.name}</span>
                <ChevronsUpDown aria-hidden="true" className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isMobile ? 'top' : 'right'}
              align="end"
              sideOffset={4}
              className="min-w-56"
            >
              <DropdownMenuGroup aria-labelledby={themeLabelId}>
                <DropdownMenuLabel id={themeLabelId}>Tema</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={theme.choice}
                  onValueChange={(value) => {
                    if (isThemeChoice(value)) theme.setChoice(value);
                  }}
                >
                  {THEMES.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout.mutate()}>
                <LogOut aria-hidden="true" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <div role="alert" className="px-2 text-sm text-destructive empty:hidden">
        {logout.isError ? 'Não foi possível sair. Tente de novo.' : null}
      </div>
    </>
  );
}
