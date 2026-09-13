import type {
  ScoutPrematchDiscoveryV2InputEnvelope,
  ScoutPrematchDiscoveryV2ResultEnvelope,
  ScoutPrematchGameV2InputEnvelope,
  ScoutPrematchGameV2ResultEnvelope,
} from "#src/workflow-contracts-v2.ts";
import { SCOUT_WORKFLOW_NAMES } from "#src/identifiers.ts";
import { unimplementedV2Workflow } from "./unimplemented-v2.ts";

/**
 * Prematch discovery, V2.
 *
 * Polls spectator state for tracked accounts and starts one
 * `scoutPrematchGameV2Workflow` per live game. The child carries a game
 * REFERENCE, never the spectator payload: the payload is large, is already
 * destined for the object store, and would otherwise be copied into a
 * Workflow history that keeps it forever.
 */
export function scoutPrematchDiscoveryV2Workflow(
  input: ScoutPrematchDiscoveryV2InputEnvelope,
): Promise<ScoutPrematchDiscoveryV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.prematchDiscoveryV2,
    input.kind,
  );
}

/**
 * One live game, V2.
 *
 * Archives the spectator snapshot, receipts it, then fans out the
 * game-starting notifications. The snapshot is keyed by the match id Riot will
 * later assign — `scoutPrematchGameV2MatchId` composes it from the platform
 * and game id the reference already carries — so the prematch snapshot, the
 * eventual match payload and its timeline all land in one receipt scope.
 *
 * Several tracked accounts can be in the same game, and they are the same
 * snapshot. The Workflow ID drops the puuid for exactly that reason, so the
 * duplicates collapse instead of racing.
 */
export function scoutPrematchGameV2Workflow(
  input: ScoutPrematchGameV2InputEnvelope,
): Promise<ScoutPrematchGameV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.prematchGameV2,
    input.kind,
  );
}
