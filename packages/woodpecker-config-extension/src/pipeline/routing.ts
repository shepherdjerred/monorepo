import type { CiStep } from "#src/pipeline/model.ts";

export type RoutingContext = {
  readonly event: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly draft: boolean;
  readonly maintenance?: boolean;
};

/** Agent pools and Kueue priority are separate from production pod priority. */
export function routeSteps(
  steps: readonly CiStep[],
  context: RoutingContext,
  trustedGateImage?: string,
): CiStep[] {
  const main =
    context.maintenance !== true &&
    (context.event === "push" || context.event === "manual") &&
    context.branch === context.defaultBranch;
  const priority = main
    ? "ci-main"
    : context.draft || context.maintenance === true
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
