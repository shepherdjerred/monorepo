import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";

/** Every narrowing retains the logical command's observation captured before its first await. */
export async function bindMovieHistoryDeadlineV3(
  tx: Prisma.TransactionClient,
  input: {
    observed: { wall: number; monotonic: number };
    guards: readonly PlexBindingFreshness[];
  },
) {
  const freshness = plexBindingFreshness({
    observed: input.observed,
    expiresAtMs: Math.min(
      input.observed.wall + 60_000,
      ...input.guards.map((guard) => guard.expiresAtMs),
    ),
    guards: input.guards,
  });
  await bindPlexTransactionDeadline(tx, freshness);
  return freshness;
}
