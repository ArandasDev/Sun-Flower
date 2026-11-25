import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Menu } from './components/Menu.tsx';
import { ReconnectBanner } from './components/ReconnectBanner.tsx';
import { LiveContext, realClock, useLiveConnection, type LiveClock } from './live.ts';
import { Cases } from './routes/Cases.tsx';
import { Login } from './routes/Login.tsx';
import { Overview } from './routes/Overview.tsx';
import { Profile } from './routes/Profile.tsx';
import { RequireSession } from './session.tsx';

/** Below `RequireSession`, so the live connection only opens once `/api/me` succeeded. */
function LiveShell({ clock }: { clock: LiveClock }) {
  const location = useLocation();
  const live = useLiveConnection(clock);
  return (
    <LiveContext.Provider value={live}>
      <div className="shell">
        <ReconnectBanner />
        <Menu />
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={location.pathname}
            className="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <Routes location={location}>
              <Route index element={<Profile />} />
              <Route path="visao-geral" element={<Overview />} />
              <Route path="casos" element={<Cases />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.main>
        </AnimatePresence>
      </div>
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
