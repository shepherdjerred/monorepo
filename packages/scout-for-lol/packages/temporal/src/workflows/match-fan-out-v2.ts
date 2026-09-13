import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutStage } from "#src/contracts.ts";
import type { ScoutFanOutV2Result } from "#src/activity-contracts-v2.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutLakeProjectionV2WorkflowId,
  scoutNotificationV2WorkflowId,
} from "#src/identifiers.ts";
import {
  scoutLakeProjectionV2InputCodec,
  scoutNotificationV2InputCodec,
  type ScoutLakeProjectionV2InputEnvelope,
  type ScoutNotificationV2InputEnvelope,
} from "#src/workflow-contracts-v2.ts";

/**
 * The post-commit fan-out, expressed as a plan rather than as starts.
 *
 * `planMatchFanOutV2` answers which children the durable state calls for; this
 * module turns that answer into the exact child specifications — Workflow
 * Type, Workflow ID and serialized input — that starting them requires. It is
 * a pure function of the plan, so the per-match Workflow's fan-out decision is
 * assertable without a Temporal environment and without any child existing.
 *
 * ## Why nothing is started yet
 *
 * `scoutNotificationV2Workflow` and `scoutLakeProjectionV2Workflow` are
 * registered contracts whose bodies are still `unimplementedV2Workflow` stubs
 * (they belong to other lanes). Starting one would not defer the work, it
 * would destroy it: the stub fails NON-RETRYABLY, and the child IDs below are
 * derived from the intent key and match id, so the failed execution would own
 * that ID. A later run computing the same ID would then be refused by
 * `ALLOW_DUPLICATE_FAILED_ONLY`'s sibling case, or would adopt a history whose
 * only content is a failure. Planning and not starting leaves the durable
 * intent rows exactly as the reconciliation sweep expects to find them.
 *
 * ## The seam
 *
 * The lane that implements a child adds its name to
 * {@link IMPLEMENTED_V2_FAN_OUT_WORKFLOWS} and the per-match Workflow starts
 * every planned child whose type is listed, with `parentClosePolicy: "ABANDON"`
 * — a notification outlives the match run that promised it, and the parent
 * closing must not cancel a send. Nothing else about this module changes.
 */

export type ScoutMatchFanOutChildV2 =
  | {
      readonly family: "notifications";
      readonly workflowType: typeof SCOUT_WORKFLOW_NAMES.notificationV2;
      readonly workflowId: string;
      readonly input: ScoutNotificationV2InputEnvelope;
    }
  | {
      readonly family: "lakeProjections";
      readonly workflowType: typeof SCOUT_WORKFLOW_NAMES.lakeProjectionV2;
      readonly workflowId: string;
      readonly input: ScoutLakeProjectionV2InputEnvelope;
    };

/**
 * Which fan-out Workflow Types have an implementation behind them.
 *
 * Empty on purpose: see the module comment. The per-match Workflow reads this
 * rather than a boolean so a lane can land one child without the other.
 */
export const IMPLEMENTED_V2_FAN_OUT_WORKFLOWS: readonly ScoutMatchFanOutChildV2["workflowType"][] =
  [];

/**
 * The children one match's committed state calls for.
 *
 * Notification children come from the intent keys the Activity READ from the
 * durable rows, never from channels the Workflow derived: an intent minted by
 * another producer would be missed, and a key guessed per channel would
 * re-mint one that already exists. The lake projection is one child per match,
 * keyed by the match, so a rediscovery collapses onto it.
 */
export function planMatchFanOutChildrenV2(args: {
  readonly stage: ScoutStage;
  readonly riotMatchId: RiotMatchId;
  readonly plan: ScoutFanOutV2Result;
}): readonly ScoutMatchFanOutChildV2[] {
  const notifications = args.plan.notificationIntentKeys.map(
    (intentKey): ScoutMatchFanOutChildV2 => ({
      family: "notifications",
      workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
      workflowId: scoutNotificationV2WorkflowId(args.stage, intentKey),
      input: scoutNotificationV2InputCodec.serialize({
        stage: args.stage,
        intentKey,
      }),
    }),
  );
  if (!args.plan.lakeProjection) {
    return notifications;
  }
  return [
    ...notifications,
    {
      family: "lakeProjections",
      workflowType: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
      workflowId: scoutLakeProjectionV2WorkflowId(args.stage, args.riotMatchId),
      input: scoutLakeProjectionV2InputCodec.serialize({
        stage: args.stage,
        riotMatchId: args.riotMatchId,
      }),
    },
  ];
}

/** How many planned children of each family an implementation exists for. */
export function startableMatchFanOutCountsV2(
  children: readonly ScoutMatchFanOutChildV2[],
): { notifications: number; lakeProjections: number } {
  const startable = children.filter((child) =>
    IMPLEMENTED_V2_FAN_OUT_WORKFLOWS.includes(child.workflowType),
  );
  return {
    notifications: startable.filter((child) => child.family === "notifications")
      .length,
    lakeProjections: startable.filter(
      (child) => child.family === "lakeProjections",
    ).length,
  };
}
