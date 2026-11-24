import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.ts';

/**
 * Any 401 means the session is gone: refetching `['me']` makes `RequireSession` send the person
 * to the login screen.
 */
export function makeQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] === 'me') return; // RequireSession handles it; avoids a refetch loop
        if (error instanceof ApiError && error.status === 401) {
          void client.invalidateQueries({ queryKey: ['me'] });
        }
      },
    }),
  });
  return client;
}
