import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError, apiFetch, resetCsrfToken, setCsrfToken } from './api.ts';
import type { Level } from './labels.ts';

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

export function useLogout() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/logout', { method: 'POST' }),
    onSettled: () => {
      resetCsrfToken();
      client.removeQueries({ queryKey: ['me'] });
      void navigate('/login');
    },
  });
}

/** Gate for every screen except the login: loads `/api/me` and handles 401 and 503. */
export function RequireSession({ children }: { children: ReactNode }) {
  const query = useMe();
  if (query.isPending) return <p className="center-note">Carregando…</p>;
  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
    return (
      <div className="center-note" role="alert">
        <p>
          {error instanceof ApiError && error.status === 503
            ? error.message
            : 'Algo deu errado. Tente de novo.'}
        </p>
        <button type="button" className="button" onClick={() => void query.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }
  return <MeContext.Provider value={query.data}>{children}</MeContext.Provider>;
}
