import { versionSetName } from "#client/components/identifier.tsx";

/**
 * What each recorded audit action means, in the words an on-call person
 * uses. The raw code stays available as the label's `title`; an action not
 * listed here is shown as recorded.
 */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  "artifact.upstream_verified": "Upstream image checked",
  "build.source_recorded": "Commit recorded",
  "build.published": "Build published",
  "build.verified": "Build passed CI",
  "build.failed": "Build failed CI",
  "build.incompatible": "Build refused as incompatible",
  "catalog.reconciled": "Catalog reconciled",
  "catalog.service_retired": "Service retired",
  "content.recovery_requested": "Content recovery requested",
  "content.recovery_completed": "Content recovered",
  "content.recovery_failed": "Content recovery failed",
  "content.recovery_attempt_failed": "Content recovery attempt failed",
  "control_plane.requested": "Control plane release requested",
  "deployment.requested": "Deployment requested",
  "deployment.claimed": "Deployment started",
  "deployment.stage": "Deployment steps",
  "deployment.succeeded": "Deployment succeeded",
  "deployment.failed": "Deployment failed",
  "deployment.canceled": "Deployment canceled",
  "deployment.recovery_required": "Deployment needs recovery",
  "deployment.approve": "Deployment approved",
  "deployment.reject": "Deployment rejected",
  "deployment.cancel_requested": "Cancel requested",
  "deployment.lease_renewed": "Executor checked in",
  "deployment.lease_expired": "Executor stopped checking in",
  "deployment.approval_expired": "Approval expired",
  "deployment.admission_rejected": "Deployment refused",
  "deployment.superseded": "Replaced by a newer deployment",
  "deployment.handed_off": "Handed to the executor",
  "deployment.handoff_claimed": "Executor took over",
  "deployment.orphan_recovered": "Abandoned deployment recovered",
  "deployment.recovery_settled": "Recovery settled",
  "deployment.recovery_intent_abandoned": "Recovery abandoned",
  "deployment.restoration_approved": "Restore approved",
  "deployment.stale_ownership_released": "Stalled executor released",
  "environment.registered": "Environment registered",
  "environment.target_removed": "Environment target removed",
  "forum.baseline_requested": "Forum baseline requested",
  "forum.baseline_completed": "Forum baseline recorded",
  "forum.baseline_failed": "Forum baseline failed",
  "minecraft.recovery_completed": "Minecraft recovered",
  "minecraft.recovery_failed": "Minecraft recovery failed",
  "monitor.alarmed": "Monitor alarm fired",
  "monitor.settled": "Monitor settled",
  "monitor.held": "Held for an operator",
  "pipeline.registered": "Pipeline registered",
  "platform.requested": "Platform release requested",
  "platform.plan_recorded": "Plan recorded",
  "platform.plan_claimed": "Plan picked up",
  "platform.plan_approve": "Plan approved",
  "platform.plan_reject": "Plan rejected",
  "platform.selection_blocked": "Platform release blocked",
  "platform.recovery_requested": "Platform recovery requested",
  "platform.recovery_plan": "Recovery plan recorded",
  "platform.recovery_plan_approval": "Recovery plan decided",
  "platform.recovery_native": "Recovery job recorded",
  "platform.recovery_apply_admitted": "Recovery apply allowed",
  "platform.recovery_completed": "Platform recovered",
  "platform.recovery_failed": "Platform recovery failed",
  "versionSet.composed": "Release composed",
  "worker.registered": "Worker build registered",
  "worker.retirement_requested": "Worker retirement requested",
  "worker.retirement_proved": "Worker retired",
  "worker.recovery_requested": "Worker recovery requested",
  "worker.recovery_completed": "Worker recovered",
  "worker.recovery_failed": "Worker recovery failed",
};

/** A recorded action in plain words, or the action itself when it has none. */
export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

const TARGET_NAMES = {
  build: "Build",
  deployment: "Deployment",
  environment: "Environment",
  versionSet: "Version set",
} as const;

/**
 * A linked entry's spoken name. A version set read with its release starts
 * with the r-number the link shows (WCAG 2.5.3), then its id.
 */
export function targetName(
  kind: keyof typeof TARGET_NAMES,
  id: string,
  release: number | null,
) {
  return kind === "versionSet"
    ? versionSetName(release, id)
    : `${TARGET_NAMES[kind]} ${id}`;
}
