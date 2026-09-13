import type {
  ScoutMatchProcessingV2InputEnvelope,
  ScoutMatchProcessingV2ResultEnvelope,
  ScoutPostMatchDiscoveryV2InputEnvelope,
  ScoutPostMatchDiscoveryV2ResultEnvelope,
} from "#src/workflow-contracts-v2.ts";
import { SCOUT_WORKFLOW_NAMES } from "#src/identifiers.ts";
import { unimplementedV2Workflow } from "./unimplemented-v2.ts";

/**
 * Post-match discovery, V2.
 *
 * Discovers completed matches for tracked accounts, then starts one
 * `scoutMatchProcessingV2Workflow` child per match, serialized in discovery
 * order. Serialization is not incidental: bounded Dare plans are ordered by
 * match end time, so a later match must not settle while an earlier one is
 * still being processed.
 *
 * Child IDs come from `scoutMatchProcessingV2WorkflowId`, so a rediscovered
 * match collapses onto the execution already processing it rather than
 * starting a second one.
 */
export function scoutPostMatchDiscoveryV2Workflow(
  input: ScoutPostMatchDiscoveryV2InputEnvelope,
): Promise<ScoutPostMatchDiscoveryV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.postMatchDiscoveryV2,
    input.kind,
  );
}

/**
 * The per-match core, V2.
 *
 * Phases, in order: archive the raw artifacts, commit the observation, settle
 * markets, apply progression, record receipts, advance tracked-account
 * cursors, and only then fan out notification and lake-projection children.
 *
 * Fan-out happens after the domain commit because a notification is a promise
 * about a fact: a child started before the commit could deliver a claim the
 * pipeline then fails to make durable. `readMatchPipelineStateV2` is the
 * resume point — one aggregate read spanning observation, receipts, intents
 * and tracked accounts — so a restarted execution skips the phases that
 * already happened instead of re-applying them.
 */
export function scoutMatchProcessingV2Workflow(
  input: ScoutMatchProcessingV2InputEnvelope,
): Promise<ScoutMatchProcessingV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.matchProcessingV2,
    input.kind,
  );
}
