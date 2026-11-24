import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError, apiFetch, resetCsrfToken, setCsrfToken } from './api.ts';
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

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Gate for every screen except the login: loads `/api/me` and handles 401 and 503. */
export function RequireSession({ children }: { children: ReactNode }) {
  const query = useMe();
  if (query.isPending) return <p className="center-note">Carregando…</p>;
  // A failed refetch keeps the data: only a 401 (below) or a first failure replaces the shell.
  const data = query.data;
  if (data === undefined || (query.isError && isUnauthorized(query.error))) {
    if (!query.isError) return <p className="center-note">Carregando…</p>;
    const error = query.error;
    if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
    return (
      <div className="center-note" role="alert">
        <p>
          {error instanceof ApiError && error.status === 503
            ? UNAVAILABLE_TEXT
            : 'Algo deu errado. Tente de novo.'}
        </p>
        <button type="button" className="button" onClick={() => void query.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }
  return <MeContext.Provider value={data}>{children}</MeContext.Provider>;
}
