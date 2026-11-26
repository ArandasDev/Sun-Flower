import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { apiFetch } from './api.ts';

/** Runs a module operation through the server; always sends a JSON body (an empty one is `{}`). */
export async function runOperation<O>(name: string, input: object): Promise<O> {
  const body = await apiFetch<{ data: O }>(`/api/operations/${name}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.data;
}

export interface OperationQueryOptions {
  /** Keeps showing the previous key's data while a new key loads, so a filter change does not blank the list. */
  keepPrevious?: boolean;
  /** Admin reads count toward the request limit, so they skip the refetch on window focus. */
  refetchOnFocus?: boolean;
}

export function useOperationQuery<O>(
  key: QueryKey,
  name: string,
  input: object,
  options: OperationQueryOptions = {},
) {
  return useQuery({
    queryKey: key,
    queryFn: () => runOperation<O>(name, input),
    retry: false,
    ...(options.keepPrevious === true ? { placeholderData: keepPreviousData } : {}),
    ...(options.refetchOnFocus === false ? { refetchOnWindowFocus: false } : {}),
  });
}

export function useOperationMutation<O, I extends object>(
  name: string,
  options: Omit<UseMutationOptions<O, Error, I>, 'mutationFn'> = {},
) {
  return useMutation<O, Error, I>({
    ...options,
    mutationFn: (input) => runOperation<O>(name, input),
  });
}

/** A cursor-paged list: each page's `nextCursor` (`null` ends the list) is sent as `cursor`. */
export function useOperationPages<P extends { nextCursor: number | null }>(
  key: QueryKey,
  name: string,
  input: object,
) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      runOperation<P>(name, pageParam === null ? input : { ...input, cursor: pageParam }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
}
