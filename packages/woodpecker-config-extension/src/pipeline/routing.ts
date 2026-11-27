import type { CiStep, ResourceTier } from "#src/pipeline/model.ts";
import {
  CONTAINED_TIER,
  LIGHT_TIER,
  SCANNER_TIER,
} from "#src/pipeline/tiers.ts";

/**
 * Tiers whose PR workflows the `pr-light` agent pool takes: thin steps,
 * third-party scanners and single-tool contained checks. Each is small,
 * short and capped by tight limits. Every other tier -- verify, browser,
 * medium builds, the dry-run rehearsal with its heavy limits -- stays in `pr`.
 */
const PR_LIGHT_TIERS: readonly ResourceTier[] = [
  LIGHT_TIER,
  SCANNER_TIER,
  CONTAINED_TIER,
];

/** A tier is its whole shape: requests and the limits that bound them. */
function sameTier(left: ResourceTier, right: ResourceTier): boolean {
  return (
    left.cpuRequest === right.cpuRequest &&
    left.cpuLimit === right.cpuLimit &&
    left.memoryRequest === right.memoryRequest &&
    left.memoryLimit === right.memoryLimit &&
    left.ephemeralStorageRequest === right.ephemeralStorageRequest &&
    left.ephemeralStorageLimit === right.ephemeralStorageLimit
  );
}

/**
 * A short, service-free check: no services, and every container -- the
 * workflow's own and each ordered one -- in a light, scanner or contained
 * tier. Anything that raises a request (RAM scratch, a heavier tier) or adds
 * a service falls out of the pool on its own.
 *
 * `check-ci-admission-budget.ts` proves every `pr-light` slot fits its
 * reserved Kueue queue at once with the largest such container or the
 * checkout before it, so a light workflow waits only for one of its own slots.
 */
export function isPrLightWorkflow(step: CiStep): boolean {
  return (
    (step.services?.length ?? 0) === 0 &&
    [step, ...(step.orderedSteps ?? [])].every((command) =>
      PR_LIGHT_TIERS.some((tier) => sameTier(command.resources, tier)),
    )
  );
}

export type RoutingContext = {
  readonly event: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly draft: boolean;
  /** A Temporal-dispatched maintenance request (`CI_MAINTENANCE_KIND`). */
  readonly maintenance?: boolean;
  /** A manual performance benchmark or lane reproduction. */
  readonly canary?: boolean;
  /** The manual extended test tier (`CI_EXTENDED_REQUEST`) on the default branch. */
  readonly extended?: boolean;
};

/** Agent pools and Kueue priority are separate from production pod priority. */
export function routeSteps(
  steps: readonly CiStep[],
  context: RoutingContext,
  trustedGateImage?: string,
): CiStep[] {
  // Background work runs on the default branch yet must never take main's
  // reserved agent capacity. Benchmarks, reproductions and the extended tier
  // must not outrank a ready pull request either: they are admitted at the
  // lowest priority.
  //
  // Maintenance is admitted at main's priority instead. Its own agent removes
  // the wait for a slot, but at draft priority its pods would still sit in
  // the compute queue behind a standing backlog of ready PR pods. That is
  // safe to skip: maintenance is rare (one to a few runs a day), its pool
  // caps it at one concurrent workflow, and Kueue preemption is off, so it
  // only moves ahead of waiting work and never evicts running work. The
  // golden workspace refresh it carries is also CI's largest SSD-write lever.
  const maintenance = context.maintenance === true;
  const background =
    maintenance || context.canary === true || context.extended === true;
  const main =
    !background &&
    (context.event === "push" || context.event === "manual") &&
    context.branch === context.defaultBranch;
  const priority =
    main || maintenance
      ? "ci-main"
      : background || context.draft
        ? "ci-draft"
        : "ci-ready";
  return steps.map((step) => {
    if (step.backend === "local") return step;
    const gate =
      trustedGateImage !== undefined &&
      step.image === trustedGateImage &&
      step.key === "ci-complete";
    if (gate && (step.skipClone !== true || (step.services?.length ?? 0) > 0)) {
      throw new Error(
        `${step.key}: reserved gate capacity requires no checkout or services`,
      );
    }
    // Maintenance has its own one-slot agent, so the golden workspace refresh
    // never waits behind the PR backlog in the `pr` agent's first-in-first-out
    // queue. Its pods still share the compute quota. Benchmarks,
    // reproductions and the extended tier stay in the PR pool.
    //
    // Short, service-free PR checks get `pr-light` for the same reason: in
    // `pr` a one-minute scanner waited behind every verify holding a slot
    // while Kueue gated it. Main keeps them in its own pool.
    const pool = gate
      ? "completion"
      : main
        ? "main"
        : maintenance
          ? "maintenance"
          : !background && isPrLightWorkflow(step)
            ? "pr-light"
            : "pr";
    return {
      ...step,
      agentLabels: {
        ...step.agentLabels,
        "ci-pool": pool,
        // Workflow labels reach clone, service, and command pods. The agent
        // fixes the queue label so a workflow cannot borrow another reserve.
        "kueue.x-k8s.io/priority-class": priority,
      },
    };
  });
}
