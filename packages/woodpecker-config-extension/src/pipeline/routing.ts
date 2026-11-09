import type { CiStep } from "#src/pipeline/model.ts";

export type RoutingContext = {
  readonly event: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly draft: boolean;
  /** Manual maintenance or benchmark work on the default branch. */
  readonly maintenance?: boolean;
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
  // reserved capacity or outrank a ready pull request: it shares the PR pool
  // at the lowest admission priority.
  const background = context.maintenance === true || context.extended === true;
  const main =
    !background &&
    (context.event === "push" || context.event === "manual") &&
    context.branch === context.defaultBranch;
  const priority = main
    ? "ci-main"
    : background || context.draft
      ? "ci-draft"
      : "ci-ready";
  return steps.map((step) => {
    if (step.backend === "local") return step;
    const gate =
      trustedGateImage !== undefined &&
      step.image === trustedGateImage &&
      (step.key === "codex-review-gate" || step.key === "ci-complete");
    if (gate && (step.skipClone !== true || (step.services?.length ?? 0) > 0)) {
      throw new Error(
        `${step.key}: reserved gate capacity requires no checkout or services`,
      );
    }
    const pool = gate
      ? step.key === "ci-complete"
        ? "completion"
        : "review"
      : main
        ? "main"
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
