/**
 * Options for a read that carries authorization: the answer depends on the
 * viewer's current Discord membership and the guild rollout flag, so nothing is
 * retained and every mount asks again. A route and its loader share this so
 * the loader's preload and the component's query key against one entry.
 */
export const PROTECTED_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always",
} as const;
