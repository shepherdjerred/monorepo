import { Context } from "@temporalio/activity";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutLakeStagingV2ResultSchema,
  type ScoutLakeStagingV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutDurableCommitV2 } from "@scout-for-lol/temporal/contracts-v2";
import {
  lakeStagingReceiptKind,
  type ReceiptRecordOutcome,
} from "#src/report-lake/durable-receipts.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { stageMatchReceipted } from "#src/report-lake/receipted-staging.ts";
import { readArchivedMatchArtifactV2 } from "#src/temporal/v2/match-archive.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";

/**
 * The V2 lake projection: the only Activity on the lake queue.
 *
 * v1 stages the report lake inside the call that archives the match, so a slow
 * filesystem write sits in front of a live game and a projection failure has to
 * be swallowed to keep ingest moving. V2 splits them —
 * `scoutLakeProjectionV2Workflow` drives this Activity on its own queue — which
 * is what lets the projection be strict instead of best-effort: nothing
 * user-visible is waiting on it, so a staging write that did not happen can
 * simply fail the Activity and be retried.
 *
 * The projection is derived data, not a source of truth. S3 holds the canonical
 * bytes and the nightly rebuild can reconstruct every staging row from them, so
 * repeating this Activity is always safe: staging overwrites whole files under
 * keys derived from the match id, and a retry writes the same bytes.
 */

/**
 * What the receipted staging door said, in the V2 contracts' vocabulary.
 *
 * Identical to `archiveReceiptCommitV2` and for the same reasons. The door is
 * shared with v1 and answers `recorded | conflict | failed`; `recorded` is a
 * write that landed, `conflict` is a definite answer from a successful write
 * where an existing receipt for this identity carries different evidence, and
 * both are facts a Workflow can act on.
 *
 * `failed` throws instead of being reported. v1 can fail open — its receipt is
 * a parity record beside an authoritative pipeline — but here the receipt is
 * the only durable trace the projection ever happened. Reporting a projection
 * whose attestation did not land would tell the Workflow the lake is current
 * while leaving nothing any reader could corroborate that against. Throwing
 * sends the Activity around its retry, which costs one rewritten staging file
 * set and nothing else.
 */
function stagingReceiptCommitV2(
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
        `Staged the lake projection for ${matchId} but could not record its lake-staging receipt; retrying rather than reporting an unattested projection`,
      );
  }
}

/**
 * Project one archived match into the report lake's staging files and attest
 * to it.
 *
 * The source descriptor is read back from the match's own `raw-archive-match`
 * receipt rather than reconstructed here. A lake-staging receipt identifies its
 * projection by the S3 object key and digest the rows were derived from —
 * never by the staging paths, which name a location on one role's RWO volume
 * and would be a claim no other reader could evaluate — and the only honest
 * answer to "which bytes produced these rows" is the descriptor the run that
 * archived them actually reported. A key rebuilt from the layout convention
 * would be evidence of nothing.
 *
 * The staging paths `stageMatchReceipted` returns therefore stop here. They are
 * for this Activity's own logging; `stagedFileCount` is the shape of the
 * projection — how many staging relations this capture writes — which is a
 * property of the capture rather than of a filesystem, and is the only part of
 * the result that survives into the Workflow.
 *
 * {@link ReceiptedStagingError} is deliberately not caught. v1 translates it
 * into a `false` because its callers have always decided something else with
 * that boolean; a V2 Activity has no such obligation, and a projection that did
 * not happen is a retryable failure that records no receipt — which is exactly
 * the fail-open door V2 exists not to have.
 *
 * Nothing here runs inside `recordDurableWrite`: the receipted door records
 * through `recordReceiptFailOpen`, which refuses outright to run inside a
 * durable write scope because both wrappers count a completed write and nesting
 * them would record one fact twice.
 */
export async function stageLakeProjectionV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutLakeStagingV2Result> {
  const source = await readArchivedMatchArtifactV2(input.riotMatchId);
  if (source === null) {
    // The match was never archived — either this ran ahead of the archive, or
    // on the dev/test no-bucket path where nothing is ever put. There is no
    // source object for a staging receipt to name, so there is no honest claim
    // to record and nothing to project from, exactly as
    // `archiveMatchArtifactsV2` reports no artifacts on its no-bucket branch.
    return ScoutLakeStagingV2ResultSchema.parse({
      receipts: [],
      stagedFileCount: 0,
    });
  }

  // Both halves below are slow and unattended: the payload comes from Riot over
  // the network, and the staging write flattens a full match onto disk. The
  // Activity heartbeats across each of them so a worker that dies mid-write is
  // detected by its heartbeat timeout rather than by its start-to-close budget,
  // and so an operator watching the Activity can tell fetching from writing.
  const activity = Context.current();
  activity.heartbeat({
    riotMatchId: input.riotMatchId,
    phase: "resolving-match-payload-v2",
    sourceObjectKey: source.key,
  });
  const context = await resolveScoutV2MatchContext(input.riotMatchId);

  activity.heartbeat({
    riotMatchId: input.riotMatchId,
    phase: "writing-lake-staging-v2",
  });
  const result = await stageMatchReceipted(
    resolveLakeDir(),
    context.matchData,
    { source },
  );
  activity.heartbeat({
    riotMatchId: input.riotMatchId,
    phase: "staged-lake-projection-v2",
    stagedFileCount: result.files.length,
  });

  return ScoutLakeStagingV2ResultSchema.parse({
    receipts: [
      {
        kind: lakeStagingReceiptKind("match"),
        commit: stagingReceiptCommitV2(result.receipt, input.riotMatchId),
      },
    ],
    stagedFileCount: result.files.length,
  });
}
