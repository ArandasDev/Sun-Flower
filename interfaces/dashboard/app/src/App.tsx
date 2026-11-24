import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Menu } from './components/Menu.tsx';
import { Login } from './routes/Login.tsx';
import { Overview } from './routes/Overview.tsx';
import { Profile } from './routes/Profile.tsx';
import { RequireSession } from './session.tsx';

function Shell() {
  const location = useLocation();
  return (
    <RequireSession>
      <div className="shell">
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.main>
        </AnimatePresence>
      </div>
    </RequireSession>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
