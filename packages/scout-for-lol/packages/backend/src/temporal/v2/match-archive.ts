import { ApplicationFailure } from "@temporalio/common";
import type { ArtifactDescriptor } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  ScoutArchivedArtifactV2,
  ScoutArchiveV2Result,
  ScoutMatchObservationV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutDurableCommitV2 } from "@scout-for-lol/temporal/contracts-v2";
import { prisma } from "#src/database/index.ts";
import {
  getObservation,
  observeMatch,
  promoteObservation,
} from "#src/database/durable/observation-repository.ts";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";
import { recordTrackedAccounts } from "#src/database/durable/tracked-account-repository.ts";
import { trackedAccountRecords } from "#src/durable/match/archive-facts.ts";
import {
  isoInstantFromEpochMs,
  platformRouteOf,
  toIsoInstant,
} from "#src/durable/match/match-identity.ts";
import {
  rawArchiveEvidenceCodec,
  rawArchiveReceiptKind,
  type ReceiptRecordOutcome,
} from "#src/report-lake/durable-receipts.ts";
import { archiveMatchReceipted } from "#src/report-lake/receipted-archive.ts";
import { durableCommitV2 } from "#src/temporal/v2/match-commits.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";

/**
 * The V2 core's capture step and the observation it hangs off.
 *
 * Only the MatchV5 payload is archived here. v1 couples the S3 write to the
 * report lake's staging write because it has nowhere else to put the
 * projection; V2 has `scoutLakeProjectionV2Workflow` and `stageLakeProjectionV2`
 * on the lake queue for exactly that, so a slow projection can never sit in
 * front of a live match. The timeline stays with the phases that decide they
 * need it — settlement and progression fetch it conditionally, as they always
 * have — because archiving one unconditionally would spend a Riot read on
 * every match to capture an artifact most of them never use.
 */

/**
 * The descriptor of the match payload this pipeline already archived, read
 * back from its own receipt.
 *
 * The receipt is the hand-off between two Activities that cannot share memory:
 * `raw-archive-match`'s evidence IS the `ArtifactDescriptor`, so the run that
 * commits the observation can stamp the artifact identity the run that
 * archived it reported, rather than reconstructing a key from the layout
 * convention — which would be evidence of nothing.
 */
export async function readArchivedMatchArtifactV2(
  matchId: RiotMatchId,
): Promise<ArtifactDescriptor | null> {
  const kind = rawArchiveReceiptKind("match");
  const receipts = await listReceipts(prisma, { matchId });
  const archived = receipts.find((record) => record.receipt.kind === kind);
  if (archived?.evidence == null) {
    return null;
  }
  return rawArchiveEvidenceCodec.parse(JSON.parse(archived.evidence));
}

/**
 * What a receipted door said, in the V2 contracts' vocabulary.
 *
 * The door is shared with v1 and answers `recorded | conflict | failed`,
 * collapsing the repository's first-write and replay answers into `recorded`.
 * That collapse costs nothing here because this path only runs when no
 * `raw-archive-match` receipt exists yet, so a recorded write genuinely is the
 * first one and a conflict genuinely is a racing writer.
 *
 * `failed` throws rather than being reported. v1 can fail open — its receipt
 * is a parity record beside an authoritative pipeline — but a V2 Activity
 * whose attestation did not land would report an artifact nothing can
 * corroborate, and the resumed run that reads the receipts back would then
 * archive again believing nothing had happened. Failing sends the Activity
 * around its retry, and the content-addressed put makes that repeat harmless.
 */
function archiveReceiptCommitV2(
  outcome: ReceiptRecordOutcome,
  matchId: RiotMatchId,
): ScoutDurableCommitV2 {
  switch (outcome) {
    case "recorded":
      return { outcome: "applied" };
    case "conflict":
      return { outcome: "conflict", reason: "receipt-evidence-mismatch" };
    case "failed":
      throw new Error(
        `Archived ${matchId} but could not record its raw-archive receipt; retrying rather than reporting an unattested artifact`,
      );
  }
}

/**
 * Archive one match's raw payload, at most once, and attest to it.
 *
 * The replay gate is the receipt rather than an effect claim, and that is
 * deliberate: `ArtifactDescriptor.capturedAt` is stamped at put time, so a
 * second archive of the same match records genuinely different evidence and
 * would be answered `receipt-evidence-mismatch` — a drift signal raised by the
 * system working correctly. Reading the receipt first means a replay reports
 * the first run's descriptor and writes nothing.
 */
export async function archiveMatchArtifactsV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutArchiveV2Result> {
  const archived = await readArchivedMatchArtifactV2(input.riotMatchId);
  if (archived !== null) {
    const artifact: ScoutArchivedArtifactV2 = {
      descriptor: archived,
      outcome: "already-stored",
      receipt: {
        kind: rawArchiveReceiptKind(archived.kind),
        commit: { outcome: "already-applied" },
      },
    };
    return { artifacts: [artifact] };
  }

  const context = await resolveScoutV2MatchContext(input.riotMatchId);
  const result = await archiveMatchReceipted(
    context.matchData,
    context.trackedPlayers.map((player) => player.alias),
  );
  if (result.status === "skipped_no_bucket") {
    // The dev/test no-bucket path. Nothing was archived, so there is no honest
    // claim to record and no descriptor to report — exactly as v1 records
    // nothing here.
    return { artifacts: [] };
  }
  const artifact: ScoutArchivedArtifactV2 = {
    descriptor: result.artifact,
    outcome: "stored",
    receipt: {
      kind: rawArchiveReceiptKind(result.artifact.kind),
      commit: archiveReceiptCommitV2(result.receipt, input.riotMatchId),
    },
  };
  return { artifacts: [artifact] };
}

function observationDrift(matchId: RiotMatchId, detail: string): never {
  throw ApplicationFailure.nonRetryable(
    `Cannot reconcile the observation for ${matchId}: ${detail}. Refusing to process the match on facts two producers do not share`,
    "ObservationDrift",
  );
}

/**
 * Reconcile an observation this run could not place as written.
 *
 * `observeMatch` compares everything the observation ASSERTS, so a stored
 * ARCHIVE_ONLY row and this run's FULL one differ and come back as
 * `observation-differs`. That is not drift — it is exactly the
 * archive-only-promotes-at-most-once transition the domain models, and
 * `promoteObservation` is the guarded update that performs it. A capture path
 * observed the match without downstream effects; post-match discovery has now
 * surfaced it as work, and the row moves up to FULL once and never back.
 *
 * The decision is DELEGATED to `promoteObservation` rather than re-derived
 * from the stored policy here, because that repository already mirrors the
 * domain transition and answers all three cases exactly: an archive-only row
 * promotes (`applied`), a row this pipeline already promoted answers
 * `already-applied` — which matters, since a plain Activity retry after a
 * promotion differs from the stored row in nothing but `promotedAt` and would
 * otherwise be read as fresh drift and wedge the match — and a row born FULL
 * answers `promotion-target-born-full`, meaning the disagreement is about the
 * facts rather than the policy.
 *
 * That last case and a row this pipeline does not own both fail the Activity.
 * Continuing from the stored row would let the Workflow attest to a phase and
 * advance the cursor on facts it never checked, suppressing the disagreement
 * permanently instead of surfacing it.
 */
export async function reconcileObservationConflictV2(
  matchId: RiotMatchId,
  reason: string,
): Promise<ScoutDurableCommitV2> {
  if (reason !== "observation-differs") {
    // Ownership conflicts are expected and are the Workflow's to act on: it
    // reads the stored owner and stops before any effect.
    return { outcome: "conflict", reason: "ownership-held-by-another-owner" };
  }
  const stored = await getObservation(prisma, { matchId });
  if (stored === null) {
    observationDrift(matchId, "the match has no observation to reconcile with");
  }
  if (stored.owner.kind !== "temporal-v2") {
    observationDrift(
      matchId,
      `the stored observation belongs to ${stored.owner.kind}, so its policy is not this pipeline's to promote`,
    );
  }
  const promoted = durableCommitV2(
    await promoteObservation(prisma, {
      matchId,
      promotedAt: toIsoInstant(new Date()),
    }),
  );
  if (promoted.outcome === "conflict") {
    observationDrift(
      matchId,
      `the stored observation was born FULL (${promoted.reason}), so this run differs from it in more than an archive-only promotion`,
    );
  }
  return promoted;
}

/**
 * Claim the match for the V2 pipeline and record what it saw in it.
 *
 * The observation is the claim `scoutMatchProcessingV2Workflow` needs before
 * any downstream effect: it carries the pipeline owner, so two pipelines
 * cannot both decide they are settling this match. A match already owned by
 * v1 comes back as `ownership-held-by-another-owner`, and the result reports
 * the STORED owner rather than the one this run asked for — which is what lets
 * the Workflow stop instead of double-applying v1's effects.
 *
 * The policy asked for is FULL because post-match discovery only surfaces
 * matches whose complete pipeline should run. A row already standing as
 * ARCHIVE_ONLY under this pipeline's own ownership is promoted rather than
 * refused — see {@link reconcileObservationConflictV2} — and the result then
 * reports the promoted policy, so the Workflow runs the downstream effects
 * instead of skipping them on a stale policy.
 */
export async function commitMatchObservationV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutMatchObservationV2Result> {
  const context = await resolveScoutV2MatchContext(input.riotMatchId);
  const archived = await readArchivedMatchArtifactV2(input.riotMatchId);
  const observed = durableCommitV2(
    await observeMatch(prisma, {
      matchId: input.riotMatchId,
      platformRoute: platformRouteOf(input.riotMatchId),
      policy: "FULL",
      owner: { kind: "temporal-v2" },
      promotion: null,
      gameCreatedAt: isoInstantFromEpochMs(context.matchData.info.gameCreation),
      observedAt: toIsoInstant(new Date()),
      artifacts: {
        match:
          archived === null
            ? null
            : { key: archived.key, digest: archived.digest },
        timeline: null,
      },
    }),
  );
  const commit =
    observed.outcome === "conflict"
      ? await reconcileObservationConflictV2(input.riotMatchId, observed.reason)
      : observed;

  await recordTrackedAccounts(
    prisma,
    await trackedAccountRecords(
      prisma,
      input.riotMatchId,
      context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
    ),
  );

  const stored = await getObservation(prisma, { matchId: input.riotMatchId });
  if (stored === null) {
    throw new Error(
      `MatchObservation ${input.riotMatchId} vanished between its commit and its read-back`,
    );
  }
  return {
    commit,
    owner: stored.owner,
    policy: stored.policy,
    promoted: stored.promotion !== null,
  };
}
