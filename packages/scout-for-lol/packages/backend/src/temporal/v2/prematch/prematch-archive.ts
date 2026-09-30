import { ApplicationFailure } from "@temporalio/common";
import type { RawCurrentGameInfo } from "@scout-for-lol/data";
import type {
  ScoutArchivedArtifactV2,
  ScoutPrematchArchiveV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type {
  ScoutDurableCommitV2,
  ScoutGameRefV2,
} from "@scout-for-lol/temporal/contracts-v2";
import { scoutPrematchGameV2MatchId } from "@scout-for-lol/temporal/identifiers";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import type { MatchProcessingReceiptRecord } from "#src/database/durable/receipt-row.ts";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  lakeStagingReceiptKind,
  rawArchiveReceiptKind,
  type ReceiptRecordOutcome,
} from "#src/report-lake/durable-receipts.ts";
import { archivePrematchReceipted } from "#src/report-lake/receipted-archive.ts";
import { stagePrematchReceipted } from "#src/report-lake/receipted-staging.ts";
import { recordPrematchDeliveryIntentsV2 } from "#src/temporal/v2/prematch/prematch-intents.ts";
import { recordClashPrematchSightings } from "#src/league/clash/sighting.ts";
import {
  resolveScoutV2PrematchContext,
  type ScoutV2PrematchContext,
} from "#src/temporal/v2/prematch/prematch-context.ts";
import { resumeArchivedPrematchContext } from "#src/temporal/v2/prematch/prematch-resume.ts";

/**
 * The V2 per-game core's one Activity: capture the spectator snapshot and
 * record who is owed a notification about it.
 *
 * Both the S3 object and the lake projection are written here, which is where
 * this path differs from the per-match core. That core defers staging to
 * `stageLakeProjectionV2` on the lake queue so a slow projection cannot sit in
 * front of a live match; a prematch snapshot has nowhere to defer TO. The lake
 * projection Workflow is keyed by a match id and projects the MatchV5 payload,
 * which does not exist while the game is still being played, and the prematch
 * result contract has no lake child to report. One prematch row set is also
 * not the hazard a full match projection is.
 *
 * Every write is gated on its own receipt read. Both receipts' evidence is
 * derived from the artifact's identity alone — capture time lives in the
 * receipt's `recordedAt`, not in what it attests — so a retry that wrote again
 * would be answered `already-applied`; the reads are what keep the put and the
 * staging write themselves from repeating, and what make a retry report the
 * first attempt's descriptor rather than a fresh one.
 */

/**
 * What a receipted door said, in the V2 contracts' vocabulary.
 *
 * The doors are shared with v1 and answer `recorded | conflict | failed`. Only
 * one of the three is a commit this Activity may report, and the other two
 * fail for opposite reasons.
 *
 * `failed` throws RETRYABLY: v1 can fail open because its receipt is a parity
 * record beside an authoritative pipeline, but a V2 Activity whose attestation
 * did not land would report a capture nothing can corroborate — and the retry
 * that reads the receipts back would then capture again believing nothing had
 * happened. The receipt write is the transient part, so a retry is the fix.
 *
 * `conflict` throws NON-RETRYABLY, and must never be returned as a commit.
 * Every call below is already gated on a receipt read, so this path only
 * records when no receipt existed at read time — which makes a conflict mean
 * another writer recorded DIFFERENT evidence for the same identity in between:
 * two producers disagreeing about the canonical bytes of one snapshot. Handing
 * that back as a commit would put the receipt's kind in the Workflow's
 * `receiptKinds`, so the run would claim an attestation it does not have, the
 * child would complete, and the per-game Workflow ID would be owned by a
 * completed execution no later poll re-examines. The drift would exist only
 * inside one Activity result.
 *
 * Non-retryable specifically because a retry would BURY it: the next attempt
 * reads the standing receipt and reports `already-stored`, converging quietly
 * on the other writer's descriptor. Failing terminally surfaces the
 * disagreement once, loudly, and the next poll's `ALLOW_DUPLICATE_FAILED_ONLY`
 * still lets a replacement run converge.
 */
export function receiptedCommitV2(
  outcome: ReceiptRecordOutcome,
  what: string,
): ScoutDurableCommitV2 {
  switch (outcome) {
    case "recorded":
      return { outcome: "applied" };
    case "conflict":
      throw ApplicationFailure.nonRetryable(
        `${what} but a receipt for that identity already carries different evidence; two producers disagree about this snapshot's canonical bytes`,
        "ReceiptEvidenceMismatch",
      );
    case "failed":
      throw new Error(
        `${what} but its receipt could not be recorded; retrying rather than reporting an unattested capture`,
      );
  }
}

/**
 * Put the spectator payload in S3 unless it is already there.
 *
 * The gate is the DOOR's, not this Activity's. `archivePrematchReceipted` reads
 * the standing receipt, puts and attests inside one advisory-locked
 * transaction, so it — and only it — can answer that question without racing
 * the other pipeline, which enters through the same door. This translates its
 * three answers into the V2 contract's vocabulary and adds nothing to the
 * decision.
 *
 * `null` is the dev/test no-bucket path: nothing was archived, so there is no
 * descriptor to name and no honest claim to record — and without a descriptor
 * there is no source for a staging receipt either, exactly as v1 falls back to
 * the unreceipted staging door there.
 */
type CapturedSnapshotV2 = {
  readonly artifact: ScoutArchivedArtifactV2;
  /**
   * The bytes the descriptor actually describes, which the lake projection has
   * to be derived from. They are this run's payload when it did the archiving,
   * and the earlier capture's when the door found one already stored.
   */
  readonly canonical: RawCurrentGameInfo;
};

async function archiveSnapshotV2(
  context: ScoutV2PrematchContext,
): Promise<CapturedSnapshotV2 | null> {
  const kind = rawArchiveReceiptKind("prematch");
  const result = await archivePrematchReceipted(
    context.gameInfo,
    context.trackedPlayers.map((player) => player.alias),
  );
  if (result.status === "skipped_no_bucket") return null;
  if (result.status === "already_archived") {
    return {
      canonical: result.canonical,
      artifact: {
        descriptor: result.artifact,
        outcome: "already-stored",
        receipt: { kind, commit: { outcome: "already-applied" } },
      },
    };
  }
  return {
    canonical: context.gameInfo,
    artifact: {
      descriptor: result.artifact,
      outcome: "stored",
      receipt: {
        kind,
        commit: receiptedCommitV2(
          result.receipt,
          `Archived the ${context.riotMatchId} spectator snapshot`,
        ),
      },
    },
  };
}

/**
 * Project the snapshot into the report lake unless a previous attempt already
 * did.
 *
 * The staging receipt's evidence is derived from the source descriptor and the
 * file list alone, so a retry that did re-stage would serialize byte-identical
 * evidence; the read is what keeps the file write itself from repeating.
 *
 * The rows come from `captured.canonical` rather than from the capture
 * context's own payload, because those are not always the same bytes: when the
 * door reports the snapshot already archived, its descriptor describes an
 * earlier capture of this game. Projecting the fresher payload under that
 * descriptor would make the lake disagree with its own receipt.
 */
async function stageSnapshotV2(
  captured: CapturedSnapshotV2,
  riotMatchId: RiotMatchId,
  observedAt: Date,
  receipts: readonly MatchProcessingReceiptRecord[],
): Promise<ScoutArchivedArtifactV2> {
  const kind = lakeStagingReceiptKind("prematch");
  const descriptor = captured.artifact.descriptor;
  if (receipts.some((record) => record.receipt.kind === kind)) {
    return {
      descriptor,
      outcome: "already-stored",
      receipt: { kind, commit: { outcome: "already-applied" } },
    };
  }
  const staged = await stagePrematchReceipted(
    resolveLakeDir(),
    captured.canonical,
    observedAt,
    { source: descriptor },
  );
  return {
    descriptor,
    outcome: "stored",
    receipt: {
      kind,
      commit: receiptedCommitV2(
        staged.receipt,
        `Staged the ${riotMatchId} spectator snapshot into the report lake`,
      ),
    },
  };
}

/**
 * The archive and its lake projection, each skipped if it already stands.
 *
 * The staging receipts are read AFTER the door returns rather than alongside
 * it. The door commits its own transaction before answering, so a read taken
 * beforehand could not see a receipt a rival capture wrote while this one
 * waited on the fence.
 */
async function captureArtifactsV2(
  context: ScoutV2PrematchContext,
  observedAt: Date,
  riotMatchId: RiotMatchId,
): Promise<ScoutArchivedArtifactV2[]> {
  const captured = await archiveSnapshotV2(context);
  if (captured === null) return [];
  const receipts = await listReceipts(prisma, { matchId: riotMatchId });
  return [
    captured.artifact,
    await stageSnapshotV2(captured, riotMatchId, observedAt, receipts),
  ];
}

/**
 * Capture one live game, at most once, and record who is owed a notification.
 *
 * ## Durable state first, live state second
 *
 * The order of these two reads is the whole correctness of a resumed run. This
 * Activity has three durable effects — the object, the lake projection and the
 * notification intents — and a run can die between any of them. If it asked
 * Riot first, an attempt that archived the snapshot and then died would be told
 * "that game is over" the moment the game ended, report an empty capture, and
 * complete; the projection would never be staged, the intents would never be
 * minted, and the completed game-scoped Workflow ID would seal all of it.
 *
 * So the archive is consulted BEFORE the spectator endpoint. If a
 * `raw-archive-prematch` receipt stands, this run resumes from the archived
 * canonical payload — S3 is the raw store the report lake rebuilds from, so
 * those bytes are as good as the live ones and better than nothing — and
 * finishes the remaining phases from it without Riot being involved. A live
 * absence is only ever believed when nothing was archived in the first place,
 * which is the one state in which it is actually informative.
 *
 * A game that was never archived and is no longer live comes back with no
 * artifacts: the snapshot was missed and no retry can recover it, which is an
 * external-boundary answer rather than a failure. The Workflow reads the same
 * emptiness and reports a no-op instead of claiming a snapshot exists.
 *
 * The intents are minted after the capture because they are a promise about
 * it. They are minted even on the no-bucket path, where the game was still
 * genuinely observed and the channels are still owed the announcement — only
 * the archival record is missing, and that is the dev/test environment's own
 * choice.
 */
export async function archivePrematchSnapshotV2(
  input: ScoutGameRefV2,
): Promise<ScoutPrematchArchiveV2Result> {
  const riotMatchId = scoutPrematchGameV2MatchId(input.gameRef);
  const context =
    (await resumeArchivedPrematchContext(riotMatchId)) ??
    (await resolveScoutV2PrematchContext(input.gameRef));
  if (context === null) return { artifacts: [], riotMatchId };

  const observedAt = new Date();
  const artifacts = await captureArtifactsV2(context, observedAt, riotMatchId);
  await recordClashPrematchSightings(
    context.gameInfo,
    new Set(
      context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
    ),
  );
  await recordPrematchDeliveryIntentsV2(context, observedAt);
  return { artifacts, riotMatchId };
}
