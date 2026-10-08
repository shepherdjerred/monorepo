import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutStage } from "#src/contracts.ts";
import type { ScoutFanOutResult } from "#src/activity-contracts.ts";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutLakeProjectionWorkflowId,
  scoutNotificationWorkflowId,
} from "#src/identifiers.ts";
import {
  scoutLakeProjectionInputCodec,
  scoutNotificationInputCodec,
  type ScoutLakeProjectionInputEnvelope,
  type ScoutNotificationInputEnvelope,
} from "#src/workflow-contracts.ts";

/**
 * The post-commit fan-out, expressed as a plan rather than as starts.
 *
 * `planMatchFanOut` answers which children the durable state calls for; this
 * module turns that answer into the exact child specifications — Workflow
 * Type, Workflow ID and serialized input — that starting them requires. It is
 * a pure function of the plan, so the per-match Workflow's fan-out decision is
 * assertable without a Temporal environment and without any child existing.
 *
 * ## Why planning is separate from starting
 *
 * A V2 Workflow Type is registered long before its body exists, and starting
 * one whose body is still an `unimplementedWorkflow` stub would not defer
 * the work, it would destroy it: the stub fails NON-RETRYABLY, and the child
 * IDs below are derived from the intent key and match id, so the failed
 * execution would own the ID every later run computes. A run that then asked
 * for the same ID would be refused by `ALLOW_DUPLICATE_FAILED_ONLY`'s sibling
 * case, or would adopt a history whose only content is a failure.
 *
 * ## The seam
 *
 * The lane that implements a child adds its name to
 * {@link IMPLEMENTED_FAN_OUT_WORKFLOWS}, and the per-match Workflow starts
 * every planned child whose type is listed. Both are listed now, so the plan
 * this module computes is started rather than merely counted. This module
 * stays free of `startChild` on purpose: the fan-out DECISION is a pure
 * function of the durable state and has to be assertable without a Temporal
 * environment and without any child existing, which is what
 * {@link startableMatchFanOutCounts} is for.
 */

export type ScoutMatchFanOutChild =
  | {
      readonly family: "notifications";
      readonly workflowType: typeof SCOUT_WORKFLOW_NAMES.notification;
      readonly workflowId: string;
      readonly input: ScoutNotificationInputEnvelope;
    }
  | {
      readonly family: "lakeProjections";
      readonly workflowType: typeof SCOUT_WORKFLOW_NAMES.lakeProjection;
      readonly workflowId: string;
      readonly input: ScoutLakeProjectionInputEnvelope;
    };

/**
 * Which fan-out Workflow Types have an implementation behind them.
 *
 * Both, as of the durable lane. The per-match Workflow reads this rather than a
 * boolean so a lane could land one child without the other, which is exactly
 * what it was for while only one of these had a body.
 */
export const IMPLEMENTED_FAN_OUT_WORKFLOWS: readonly ScoutMatchFanOutChild["workflowType"][] =
  [SCOUT_WORKFLOW_NAMES.notification, SCOUT_WORKFLOW_NAMES.lakeProjection];

/**
 * The children one match's committed state calls for.
 *
 * Notification children come from the intent keys the Activity READ from the
 * durable rows, never from channels the Workflow derived: an intent minted by
 * another producer would be missed, and a key guessed per channel would
 * re-mint one that already exists. The lake projection is one child per match,
 * keyed by the match, so a rediscovery collapses onto it.
 */
export function planMatchFanOutChildren(args: {
  readonly stage: ScoutStage;
  readonly riotMatchId: RiotMatchId;
  readonly plan: ScoutFanOutResult;
}): readonly ScoutMatchFanOutChild[] {
  const notifications = args.plan.notificationIntentKeys.map(
    (intentKey): ScoutMatchFanOutChild => ({
      family: "notifications",
      workflowType: SCOUT_WORKFLOW_NAMES.notification,
      workflowId: scoutNotificationWorkflowId(args.stage, intentKey),
      input: scoutNotificationInputCodec.serialize({
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
      workflowType: SCOUT_WORKFLOW_NAMES.lakeProjection,
      workflowId: scoutLakeProjectionWorkflowId(args.stage, args.riotMatchId),
      input: scoutLakeProjectionInputCodec.serialize({
        stage: args.stage,
        riotMatchId: args.riotMatchId,
      }),
    },
  ];
}

/** How many planned children of each family an implementation exists for. */
export function startableMatchFanOutCounts(
  children: readonly ScoutMatchFanOutChild[],
): { notifications: number; lakeProjections: number } {
  const startable = children.filter((child) =>
    IMPLEMENTED_FAN_OUT_WORKFLOWS.includes(child.workflowType),
  );
  return {
    notifications: startable.filter((child) => child.family === "notifications")
      .length,
    lakeProjections: startable.filter(
      (child) => child.family === "lakeProjections",
    ).length,
  };
}
