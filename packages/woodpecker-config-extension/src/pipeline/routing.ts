import type { CiStep } from "#src/pipeline/model.ts";

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
    const pool = gate
      ? "completion"
      : main
        ? "main"
        : maintenance
          ? "maintenance"
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
