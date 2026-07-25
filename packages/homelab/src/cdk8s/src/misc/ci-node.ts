import { Node, NodeTaintQuery, TaintEffect } from "cdk8s-plus-31";
import type { TaintedNode } from "cdk8s-plus-31";

/**
 * liskov — the dedicated CI-only worker node (Ryzen 9950X, 128GB).
 *
 * The node carries the taint `ci=only:NoSchedule` from its Talos machine
 * config (src/talos/liskov/patches/image.yaml), so nothing schedules there
 * without a toleration. Two kinds of workloads tolerate it:
 *
 * - Per-node system/observability pods (monitoring collectors, CSI node
 *   plugin) — they TOLERATE the taint so liskov is monitored and can
 *   provision volumes, but are not pinned to it.
 * - Buildkite CI step pods — they tolerate AND select the node
 *   (buildkite.ts pod-spec-patch), so CI runs only on liskov and liskov
 *   runs only CI.
 *
 * See packages/docs/plans/2026-07-25_liskov-cluster-join.md.
 */
export const CI_NODE_HOSTNAME = "liskov";
export const CI_TAINT_KEY = "ci";
export const CI_TAINT_VALUE = "only";

/**
 * Raw Kubernetes toleration object for Helm values and pod-spec-patch use.
 * Keep in sync with ciNodeTaintedNode below.
 */
export const CI_NODE_TOLERATION = {
  key: CI_TAINT_KEY,
  operator: "Equal",
  value: CI_TAINT_VALUE,
  effect: "NoSchedule",
};

/** cdk8s-plus form of the same toleration, for `workload.scheduling.tolerate(...)`. */
export function ciNodeTaintedNode(): TaintedNode {
  return Node.tainted(
    NodeTaintQuery.is(CI_TAINT_KEY, CI_TAINT_VALUE, {
      effect: TaintEffect.NO_SCHEDULE,
    }),
  );
}
