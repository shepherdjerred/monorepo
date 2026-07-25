import { Node, NodeTaintQuery, TaintEffect } from "cdk8s-plus-31";
import type { TaintedNode } from "cdk8s-plus-31";

/**
 * The cluster's node registry — the single source for hostnames and node
 * roles. Both nodes get equal treatment: per-node Talos config lives at
 * src/talos/<hostname>/, and any cdk8s code that must name a node imports
 * its constant from here instead of hardcoding a string.
 *
 * torvalds — control-plane node; runs ALL prod (media, home automation,
 * monitoring, storage). Also the physical host of Intel-specific hardware
 * (RAPL power caps, i915 iGPU) and the Z-Wave USB stick, which is why
 * hardware-locality workloads pin to PROD_NODE_HOSTNAME.
 *
 * liskov — dedicated CI-only worker (Ryzen 9950X, 128GB). Carries the
 * taint `ci=only:NoSchedule` from its Talos machine config
 * (src/talos/liskov/patches/image.yaml), so nothing schedules there
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
export const PROD_NODE_HOSTNAME = "torvalds";
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
