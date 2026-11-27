import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AppHeader } from './components/AppHeader.tsx';
import { AppSidebar } from './components/AppSidebar.tsx';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar.tsx';
import { Toaster } from './components/Toaster.tsx';
import { LiveContext, realClock, useLiveConnection, type LiveClock } from './live.ts';
import { Actions } from './routes/Actions.tsx';
import { Cases } from './routes/Cases.tsx';
import { Developers } from './routes/Developers.tsx';
import { Domains } from './routes/Domains.tsx';
import { Grants } from './routes/Grants.tsx';
import { Login } from './routes/Login.tsx';
import { Logs } from './routes/Logs.tsx';
import { Modules } from './routes/Modules.tsx';
import { ModerationConfig } from './routes/ModerationConfig.tsx';
import { Overview } from './routes/Overview.tsx';
import { Profile } from './routes/Profile.tsx';
import { Sessions } from './routes/Sessions.tsx';
import { RequireSession } from './session.tsx';

/** Below `RequireSession`, so the live connection only opens once `/api/me` succeeded. */
function LiveShell({ clock }: { clock: LiveClock }) {
  const location = useLocation();
  const live = useLiveConnection(clock);
  return (
    <LiveContext.Provider value={live}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AppHeader />
          <AnimatePresence mode="wait" initial={false}>
            <motion.main
              key={location.pathname}
              className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <Routes location={location}>
                <Route index element={<Profile />} />
                <Route path="visao-geral" element={<Overview />} />
                <Route path="casos" element={<Cases />} />
                <Route path="acoes" element={<Actions />} />
                <Route path="dominios" element={<Domains />} />
                <Route path="moderacao" element={<ModerationConfig />} />
                <Route path="permissoes" element={<Grants />} />
                <Route path="desenvolvedores" element={<Developers />} />
                <Route path="modulos" element={<Modules />} />
                <Route path="logs" element={<Logs />} />
                <Route path="sessoes" element={<Sessions />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </motion.main>
          </AnimatePresence>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </LiveContext.Provider>
  );
}

function Shell({ clock }: { clock: LiveClock }) {
  return (
    <RequireSession>
      <LiveShell clock={clock} />
    </RequireSession>
  );
}

export function App({ clock = realClock }: { clock?: LiveClock }) {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<Shell clock={clock} />} />
    </Routes>
  );
}
