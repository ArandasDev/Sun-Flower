import { useLocation } from 'react-router';
import { ConnectionIndicator } from './ConnectionIndicator.tsx';
import { currentTrail } from './navigation.ts';
import { SidebarTrigger } from './ui/sidebar.tsx';

/** The bar above every screen: menu toggle, where you are, and the live connection. */
export function AppHeader() {
  const { pathname } = useLocation();
  const trail = currentTrail(pathname);
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
      <SidebarTrigger className="-ml-1" />
      {trail === null ? null : (
        <nav aria-label="Você está em" className="min-w-0">
          <ol className="m-0 flex list-none items-center gap-1.5 p-0 text-sm text-muted-foreground">
            <li className="truncate">{trail.group}</li>
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="truncate font-medium text-foreground">
              {trail.label}
            </li>
          </ol>
        </nav>
      )}
      <div className="ml-auto shrink-0">
        <ConnectionIndicator />
      </div>
    </header>
  );
}
