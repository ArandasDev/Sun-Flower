import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.ts';

/**
 * Any 401, from a query or a mutation, means the session is gone: refetching `['me']` makes
 * `RequireSession` send the person to the login screen, which clears the cache.
 */
export function makeQueryClient(): QueryClient {
  const onUnauthorized = (error: Error): void => {
    if (error instanceof ApiError && error.status === 401) {
      void client.invalidateQueries({ queryKey: ['me'] });
    }
  };
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] === 'me') return; // RequireSession handles it; avoids a refetch loop
        onUnauthorized(error);
      },
    }),
    mutationCache: new MutationCache({ onError: onUnauthorized }),
  });
  return client;
}
