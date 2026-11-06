import type { Database } from "#infrastructure/database.ts";
import { MediaError } from "#application/errors.ts";
import { isMovieHistoryScopeV3 } from "#shared/movie-editions/history-review-v3.ts";

/** Filter before the historical100 bound, including unversioned v1 JSON literally. */
export async function legacyRecoveryReviewIds(db: Database) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM "RecoveryReview" r
    WHERE NOT (r.scope @> '{"schemaVersion":3}'::jsonb)
    ORDER BY r."createdAt" DESC LIMIT 100
  `;
  return rows.map((row) => row.id);
}

export function assertLegacyRecoveryProtocol(raw: unknown) {
  if (isMovieHistoryScopeV3(raw))
    throw new MediaError(
      "movie_history_protocol_required",
      "Use the exact movie edition household review",
      409,
    );
}
