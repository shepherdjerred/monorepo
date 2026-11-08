import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";

/** Only the shared keyset predicate; scope filters, limits and order stay at each query. */
export function movieTargetAfter(
  cursor: readonly [string, MovieEditionKey] | null,
) {
  return cursor === null
    ? {}
    : {
        OR: [
          { mediaId: { gt: cursor[0] } },
          { mediaId: cursor[0], edition: { gt: cursor[1] } },
        ],
      };
}
