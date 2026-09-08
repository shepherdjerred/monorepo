import * as Sentry from "@sentry/bun";
import type { Logger, ILogObj } from "tslog";
import { z } from "zod";
import { bettingSettlementCorruptRowsTotal } from "#src/metrics/betting/betting.ts";

/** Which stored column failed validation. Closed union so it can double as a
 * bounded Prometheus label. */
export type BucksCorruptIdentityField = "discord_id" | "subject_puuid";

/**
 * A stored identity failed validation while settlement was reading it back.
 *
 * Raised in place of the raw ZodError so the settlement catches can tell
 * "this pool's rows are corrupt and need an operator" apart from transient
 * failures. Unlike `BucksStorageOverflowError` it is never retried into the
 * refund path: crediting a row whose identity cannot be validated risks
 * paying the wrong account, so the pool deliberately keeps its current state
 * until the stored value is repaired.
 */
export class BucksCorruptIdentityError extends Error {
  constructor(
    readonly field: BucksCorruptIdentityField,
    readonly betId: number,
    cause: z.ZodError,
  ) {
    super(
      `Bryan Bucks bet ${betId.toString()} has a stored ${field} that fails validation`,
      { cause },
    );
    this.name = "BucksCorruptIdentityError";
  }
}

/** Parse a value read from storage, converting a ZodError into the typed
 * corrupt-identity error carrying the bet that owns the row. */
export function parseStoredIdentity<T>(
  schema: { parse: (value: unknown) => T },
  value: unknown,
  source: { field: BucksCorruptIdentityField; betId: number },
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BucksCorruptIdentityError(source.field, source.betId, error);
    }
    throw error;
  }
}

/**
 * The one log + Sentry + metric shape for a corrupt-row settlement failure,
 * so the settle and stale-sweep paths cannot drift apart. Callers pass their
 * own module logger for provenance and call this after their transaction has
 * rolled back (the metric rule is post-commit only).
 */
export function reportCorruptBucksRow(
  log: Logger<ILogObj>,
  error: BucksCorruptIdentityError,
  scope: {
    source: "betting-settle-corrupt-row" | "betting-sweep-corrupt-row";
    matchId: string;
    poolId: number;
    serverId?: string | undefined;
  },
): void {
  log.error(
    `🧨 Bryan Bucks pool ${scope.poolId.toString()} for ${scope.matchId} is blocked by corrupt stored data (bet ${error.betId.toString()}, ${error.field}); operator repair required`,
    error,
  );
  bettingSettlementCorruptRowsTotal.inc({ field: error.field });
  Sentry.captureException(error, {
    tags: {
      source: scope.source,
      matchId: scope.matchId,
      ...(scope.serverId === undefined ? {} : { serverId: scope.serverId }),
    },
    extra: { poolId: scope.poolId, betId: error.betId, field: error.field },
  });
}
