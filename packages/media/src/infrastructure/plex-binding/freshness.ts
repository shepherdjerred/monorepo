import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { PlexBindingProtection } from "./errors.ts";

/** Capture before the first awaited observation, never when a retry completes. */
export function plexBindingFreshness(input: {
  observed: { wall: number; monotonic: number };
  expiresAtMs: number;
  guards: readonly { assertActive: () => void }[];
}): PlexBindingFreshness {
  const expiresAtMs = Math.floor(
    Math.min(input.expiresAtMs, input.observed.wall + 60_000),
  );
  const monotonicDeadline =
    input.observed.monotonic + expiresAtMs - input.observed.wall;
  if (!Number.isSafeInteger(expiresAtMs) || !Number.isFinite(monotonicDeadline))
    throw new TypeError("Plex verification deadline is invalid");
  const assertActive = () => {
    for (const guard of input.guards) guard.assertActive();
    const now = Date.now();
    if (
      now < input.observed.wall ||
      now >= expiresAtMs ||
      performance.now() >= monotonicDeadline
    )
      throw new PlexBindingProtection("verification_expired");
  };
  assertActive();
  return { expiresAtMs, assertActive };
}

/** The SQL bound survives deferred work at COMMIT; LOCAL resets on commit/rollback. */
export async function bindPlexTransactionDeadline(
  tx: Prisma.TransactionClient,
  freshness: PlexBindingFreshness,
): Promise<void> {
  freshness.assertActive();
  if (!Number.isSafeInteger(freshness.expiresAtMs))
    throw new TypeError("Invalid Plex transaction deadline");
  await tx.$queryRaw`WITH bound AS (
    SELECT set_config('media.plex_deadline_ms',
      LEAST(NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric,
        ${freshness.expiresAtMs}::numeric)::text,true) AS deadline
    )
    INSERT INTO "PlexDeadlineValidation" ("transactionId","deadlineMs")
      SELECT txid_current(),deadline::bigint FROM bound
    ON CONFLICT ("transactionId") DO UPDATE SET "deadlineMs" =
      LEAST("PlexDeadlineValidation"."deadlineMs",EXCLUDED."deadlineMs")
    RETURNING "deadlineMs"`;
  freshness.assertActive();
}
