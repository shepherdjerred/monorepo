import type { Db } from "#src/database/index.ts";
import type {
  IsoInstant,
  RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  MatchProcessingStateSchema,
  type MatchProcessingState,
} from "@scout-for-lol/domain/match-processing/states.ts";
import {
  matchObservationRecordToRow,
  matchObservationRowToRecord,
  type MatchObservationRecord,
  type MatchObservationRow,
} from "#src/database/durable/observation-row.ts";
import { matchProcessingReceiptRowToRecord } from "#src/database/durable/receipt-row.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Repository for MatchObservation.
 *
 * Ownership of a match lives on the row's primary key: observeMatch is an
 * insert-or-conflict claim, and promotion is a guarded update, both mirroring
 * the pure domain transitions (claimOwnership, promoteArchiveOnlyToFull) as
 * single guarded statements so racing writers get an expected `conflict`
 * result instead of an exception or a silent overwrite.
 *
 * Three groups of columns reconcile differently on a replay, and separating
 * them is what keeps `observation-differs` meaning "two producers disagree".
 * {@link observationClaim} is the claim itself and must match. The artifact
 * columns follow {@link reconcileArtifact}: silence is not disagreement, and a
 * first identity fills the columns in. `pipelineOwner` follows claimOwnership.
 * `observedAt` is in none of them — see {@link observationClaim}.
 */

const OBSERVE_ATTEMPTS = 3;

export type ObserveMatchResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | {
      outcome: "conflict";
      reason: "ownership-held-by-another-owner" | "observation-differs";
    };

/**
 * What an observation ASSERTS, as opposed to how it was recorded.
 *
 * `observedAt` is deliberately not part of it, for the same reason
 * `recordedAt` is not part of a receipt's identity (see
 * `receipt-repository.ts`): it is wall-clock at write time, so an ordinary
 * replay of an already-committed observation differed in exactly that column
 * and in nothing else, and every one of those was answered
 * `observation-differs` — inflating the very dual-write signal the parity
 * alerting watches with events that are the system working correctly. The
 * first observer's instant stands; it records when someone first looked, never
 * what they claim.
 *
 * The owner and artifact columns are excluded too, because each has its own
 * reconciliation rule. Everything else is the claim, and it is spelled as a
 * REST omission rather than an allowlist on purpose: a column added to the row
 * joins the claim automatically, so a new fact conflicts when producers
 * disagree instead of being silently ignored until someone notices.
 */
type ObservationClaim = Omit<
  MatchObservationRow,
  | "pipelineOwner"
  | "observedAt"
  | "matchObjectKey"
  | "matchDigest"
  | "timelineObjectKey"
  | "timelineDigest"
>;

function observationClaim(row: MatchObservationRow): ObservationClaim {
  const {
    pipelineOwner: _pipelineOwner,
    observedAt: _observedAt,
    matchObjectKey: _matchObjectKey,
    matchDigest: _matchDigest,
    timelineObjectKey: _timelineObjectKey,
    timelineDigest: _timelineDigest,
    ...claim
  } = row;
  return claim;
}

/**
 * A promoted row seen by a delayed retry of the ORIGINAL observation: the
 * incoming ARCHIVE_ONLY observation matches the stored row's pre-promotion
 * form exactly. An ordinary Temporal retry of observeMatch after a promotion
 * raced past it is benign, not upstream disagreement — only rows whose facts
 * genuinely diverge should conflict.
 */
function isRetryOfPrePromotionObservation(
  existing: MatchObservationRow,
  incoming: MatchObservationRow,
): boolean {
  if (existing.processingPolicy !== "FULL" || existing.promotedAt === null) {
    return false;
  }
  if (
    incoming.processingPolicy !== "ARCHIVE_ONLY" ||
    incoming.promotedAt !== null
  ) {
    return false;
  }
  const prePromotionForm = {
    ...existing,
    processingPolicy: "ARCHIVE_ONLY",
    promotedAt: null,
  };
  return Bun.deepEquals(
    observationClaim(prePromotionForm),
    observationClaim(incoming),
    true,
  );
}

/** One artifact's columns. The row codec keeps the pair written and read together. */
type ArtifactColumns = { key: string | null; digest: string | null };

/**
 * How an incoming artifact identity relates to the stored one.
 *
 * An observation that carries no artifact makes NO ASSERTION about it. The v1
 * path genuinely does not always know: a pass whose archive was already
 * completed by an earlier run skips the archive entirely and has no descriptor
 * to offer, so treating its silence as "there is no artifact" would turn every
 * ordinary reprocess into a conflict.
 *
 * A first identity arriving over stored NULLs FILLS THEM IN — the archive-less
 * observation becoming archived, which happens at most once because the
 * columns are never cleared. Two DIFFERENT identities stay a conflict: that is
 * two producers disagreeing about which bytes are canonical for this match,
 * and nothing about it should be softened.
 */
type ArtifactAgreement = "silent" | "backfills" | "agrees" | "disagrees";

function reconcileArtifact(
  stored: ArtifactColumns,
  incoming: ArtifactColumns,
): ArtifactAgreement {
  if (incoming.key === null) return "silent";
  if (stored.key === null) return "backfills";
  return stored.key === incoming.key && stored.digest === incoming.digest
    ? "agrees"
    : "disagrees";
}

async function resolveObservedConflict(
  db: Db,
  row: MatchObservationRow,
): Promise<ObserveMatchResult | "retry"> {
  const existing = await db.matchObservation.findUnique({
    where: { riotMatchId: row.riotMatchId },
  });
  if (existing === null) {
    throw new Error(
      `MatchObservation ${row.riotMatchId} vanished between a duplicate insert and its read-back`,
    );
  }
  const existingRow = matchObservationRecordToRow(
    matchObservationRowToRecord(existing),
  );
  const sameObservation =
    Bun.deepEquals(
      observationClaim(existingRow),
      observationClaim(row),
      true,
    ) || isRetryOfPrePromotionObservation(existingRow, row);
  if (!sameObservation) {
    return { outcome: "conflict", reason: "observation-differs" };
  }

  const matchArtifact = reconcileArtifact(
    { key: existingRow.matchObjectKey, digest: existingRow.matchDigest },
    { key: row.matchObjectKey, digest: row.matchDigest },
  );
  const timelineArtifact = reconcileArtifact(
    { key: existingRow.timelineObjectKey, digest: existingRow.timelineDigest },
    { key: row.timelineObjectKey, digest: row.timelineDigest },
  );
  if (matchArtifact === "disagrees" || timelineArtifact === "disagrees") {
    return { outcome: "conflict", reason: "observation-differs" };
  }

  // NULL is the domain's `unowned`: an observation that arrives with an
  // assigned owner claims an unowned row, exactly like claimOwnership.
  const claimsOwner =
    existingRow.pipelineOwner === null && row.pipelineOwner !== null;
  if (
    !claimsOwner &&
    row.pipelineOwner !== null &&
    row.pipelineOwner !== existingRow.pipelineOwner
  ) {
    return { outcome: "conflict", reason: "ownership-held-by-another-owner" };
  }

  // One guarded update carries everything this replay adds. The guard names
  // the NULLs it observed, so a racing writer that filled them first sends
  // this attempt back around to reconcile against what they wrote.
  const patch = {
    ...(claimsOwner ? { pipelineOwner: row.pipelineOwner } : {}),
    ...(matchArtifact === "backfills"
      ? { matchObjectKey: row.matchObjectKey, matchDigest: row.matchDigest }
      : {}),
    ...(timelineArtifact === "backfills"
      ? {
          timelineObjectKey: row.timelineObjectKey,
          timelineDigest: row.timelineDigest,
        }
      : {}),
  };
  if (Object.keys(patch).length === 0) {
    // Everything this observation asserts is already recorded.
    return { outcome: "already-applied" };
  }
  const updated = await db.matchObservation.updateMany({
    where: {
      riotMatchId: row.riotMatchId,
      ...(claimsOwner ? { pipelineOwner: null } : {}),
      ...(matchArtifact === "backfills" ? { matchObjectKey: null } : {}),
      ...(timelineArtifact === "backfills" ? { timelineObjectKey: null } : {}),
    },
    data: patch,
  });
  return updated.count === 1 ? { outcome: "applied" } : "retry";
}

/**
 * Record one observed match, claiming ownership when the record carries an
 * assigned owner and stamping the raw artifact's identity the first time one
 * arrives. Exactly one of two racing writers applies; the loser gets
 * `already-applied` for a retry that adds nothing — including one differing
 * only in its wall clock, and a delayed retry of the original ARCHIVE_ONLY
 * observation after a promotion raced past it — `applied` for a retry that
 * genuinely adds an owner or an artifact identity, an ownership conflict for a
 * different claimant, and `observation-differs` only when the facts themselves
 * disagree (which is a bug upstream, surfaced as a conflict so the caller
 * decides how loudly to fail).
 */
export async function observeMatch(
  db: Db,
  record: MatchObservationRecord,
): Promise<ObserveMatchResult> {
  const row = matchObservationRecordToRow(record);
  const created = await db.matchObservation.createMany({
    data: [row],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { outcome: "applied" };
  }
  for (let attempt = 0; attempt < OBSERVE_ATTEMPTS; attempt += 1) {
    const resolved = await resolveObservedConflict(db, row);
    if (resolved !== "retry") {
      return resolved;
    }
  }
  throw new Error(
    `Gave up observing ${row.riotMatchId} after ${String(OBSERVE_ATTEMPTS)} contended attempts`,
  );
}

export type PromoteObservationResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "promotion-target-born-full" };

/**
 * Promote an ARCHIVE_ONLY observation to FULL, at most once. Mirrors
 * promoteArchiveOnlyToFull: a retry on the promoted row is `already-applied`
 * and a row born FULL is a conflict. Promoting a match that was never
 * observed is a broken caller contract and throws.
 */
export async function promoteObservation(
  db: Db,
  args: { matchId: RiotMatchId; promotedAt: IsoInstant },
): Promise<PromoteObservationResult> {
  const promoted = await db.matchObservation.updateMany({
    where: { riotMatchId: args.matchId, processingPolicy: "ARCHIVE_ONLY" },
    data: {
      processingPolicy: "FULL",
      promotedAt: dateFromIsoInstant(args.promotedAt),
    },
  });
  if (promoted.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  if (existing === null) {
    throw new Error(
      `Cannot promote ${args.matchId}: the match was never observed`,
    );
  }
  const record = matchObservationRowToRecord(existing);
  return record.promotion === null
    ? { outcome: "conflict", reason: "promotion-target-born-full" }
    : { outcome: "already-applied" };
}

export async function getObservation(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<MatchObservationRecord | null> {
  const row = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  return row === null ? null : matchObservationRowToRecord(row);
}

/**
 * Assemble the full domain MatchProcessingState for one match — owner,
 * policy, promotion, and every receipt across all kinds. Receipt identity is
 * `(kind, version, scope)` in both the domain and the unique constraint, so
 * the whole set satisfies the state's uniqueness invariant directly.
 */
export async function getProcessingState(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<MatchProcessingState | null> {
  const observation = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  if (observation === null) {
    return null;
  }
  const record = matchObservationRowToRecord(observation);
  const receiptRows = await db.matchProcessingReceipt.findMany({
    where: { riotMatchId: args.matchId },
    orderBy: { id: "asc" },
  });
  const receipts = receiptRows.map((receiptRow) => {
    const receiptRecord = matchProcessingReceiptRowToRecord(receiptRow);
    return receiptRecord.receipt;
  });
  return MatchProcessingStateSchema.parse({
    matchId: record.matchId,
    owner: record.owner,
    policy: record.policy,
    promotion: record.promotion,
    receipts,
  });
}
