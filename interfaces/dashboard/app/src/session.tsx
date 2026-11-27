import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError, apiFetch, resetCsrfToken, setCsrfToken } from './api.ts';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import type { Level } from './labels.ts';

const UNAVAILABLE_TEXT = 'Não foi possível confirmar seu acesso agora. Tente de novo em instantes.';

export interface Me {
  id: string;
  name: string;
  avatarUrl: string | null;
  level: Level;
  permissions: string[];
  csrfToken: string;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await apiFetch<Me>('/api/me');
      setCsrfToken(me.csrfToken);
      return me;
    },
    retry: false,
    staleTime: 60_000,
  });
}

const MeContext = createContext<Me | null>(null);

/** The signed-in person; only valid below `RequireSession`. */
export function useCurrentMe(): Me {
  const me = useContext(MeContext);
  if (me === null) throw new Error('useCurrentMe must be used inside RequireSession.');
  return me;
}

/** Leaves the session for good: forgets the CSRF token and the whole cache, then goes to /login. */
export function useLeaveSession(): () => void {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useCallback(() => {
    resetCsrfToken();
    client.clear();
    void navigate('/login');
  }, [client, navigate]);
}

export function useLogout() {
  const leave = useLeaveSession();
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/logout', { method: 'POST' }),
    onSuccess: leave,
    onError: (error) => {
      // 401 means the session is already gone; any other failure keeps the session alive.
      if (error instanceof ApiError && error.status === 401) leave();
    },
  });
}

/** A centred card without the menu, like the login screen. */
function CenteredCard({ children, role }: { children: ReactNode; role?: 'alert' }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card role={role} className="w-full max-w-xl items-center px-6 text-center">
        {children}
      </Card>
    </div>
  );
}

const LOADING = (
  <CenteredCard>
    <p className="m-0">Carregando…</p>
  </CenteredCard>
);

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Gate for every screen except the login: loads `/api/me` and handles 401 and 503. */
export function RequireSession({ children }: { children: ReactNode }) {
  const query = useMe();
  if (query.isPending) return LOADING;
  // A failed refetch keeps the data: only a 401 (below) or a first failure replaces the shell.
  const data = query.data;
  if (data === undefined || (query.isError && isUnauthorized(query.error))) {
    if (!query.isError) return LOADING;
    const error = query.error;
    if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
    return (
      <CenteredCard role="alert">
        <p className="m-0">
          {error instanceof ApiError && error.status === 503
            ? UNAVAILABLE_TEXT
            : 'Algo deu errado. Tente de novo.'}
        </p>
        <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </CenteredCard>
    );
  }
  return <MeContext.Provider value={data}>{children}</MeContext.Provider>;
}
