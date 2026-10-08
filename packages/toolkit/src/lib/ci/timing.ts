import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import { workflowStatus } from "./status.ts";

type Interval = { start: number; end: number };

function interval(
  start: number | undefined,
  end: number | undefined,
  now: number,
  state: string,
): Interval | null {
  const open =
    workflowStatus(state) === "PENDING" || state.toLowerCase() === "blocked";
  if (start === undefined || start <= 0) return null;
  // Open intervals mix the server's start with the observer's local clock.
  // Clock skew is not evidence of a broken server timestamp contract.
  if (end === undefined || end === 0)
    return open ? { start, end: Math.max(now, start) } : null;
  if (end < start) throw new Error("CI timing ends before it starts");
  return { start, end };
}

/** Union, not sum: parallel workflows cannot create extra wall-clock time. */
export function occupiedSeconds(intervals: readonly Interval[]): number {
  let total = 0;
  let end = 0;
  for (const item of intervals.toSorted((a, b) => a.start - b.start)) {
    total += Math.max(0, item.end - Math.max(end, item.start));
    end = Math.max(end, item.end);
  }
  return total;
}

function duration(
  start: number | undefined,
  end: number | undefined,
  now: number,
  state: string,
) {
  const range = interval(start, end, now, state);
  return range === null ? null : range.end - range.start;
}

/** API phases include pod admission/startup; they are not process CPU time. */
export function pipelineTiming(
  pipeline: WoodpeckerPipeline,
  now = Date.now() / 1000,
) {
  const range = interval(
    pipeline.created,
    pipeline.finished,
    now,
    pipeline.status,
  );
  const workflows = pipeline.workflows.map((workflow) => ({
    name: workflow.name,
    workflowId: workflow.id ?? null,
    // Woodpecker 3.19's queue and agent stringify the workflow ID as task UUID.
    // Match the Kubernetes label's string type for direct pod correlation.
    taskId: workflow.id === undefined ? null : String(workflow.id),
    state: workflow.state,
    elapsedSeconds: duration(
      workflow.started,
      workflow.finished,
      now,
      workflow.state,
    ),
    startDelaySeconds:
      range === null || (workflow.started ?? 0) === 0
        ? null
        : (workflow.started ?? 0) - range.start,
    phases: (workflow.children ?? [])
      .filter((step) => step.type !== "service")
      .map((step) => ({
        stepId: step.id,
        name: step.name,
        state: step.state,
        kind:
          step.name === "clone"
            ? "checkout"
            : workflow.name.includes("review")
              ? "review"
              : workflow.name === "ci-complete"
                ? "completion"
                : "step",
        elapsedSeconds: duration(step.started, step.finished, now, step.state),
      })),
  }));
  const activity = pipeline.workflows.map((workflow) => ({
    range: interval(workflow.started, workflow.finished, now, workflow.state),
    // These states can be known never to have started. A terminal success or
    // failure without timestamps is missing evidence, not evidence of idleness.
    neverStarted:
      (workflow.started ?? 0) === 0 &&
      [
        "created",
        "pending",
        "waiting",
        "waiting_on_deps",
        "blocked",
        "skipped",
      ].includes(workflow.state.toLowerCase()),
  }));
  const activityKnown =
    activity.length > 0 &&
    activity.every((item) => item.range !== null || item.neverStarted);
  const occupied = occupiedSeconds(
    activity.flatMap(({ range: active }) => {
      if (active === null || range === null) return [];
      const clipped = {
        start: Math.max(active.start, range.start),
        end: Math.min(active.end, range.end),
      };
      return clipped.end > clipped.start ? [clipped] : [];
    }),
  );
  const otherWorkflows = pipeline.workflows.filter(
    (workflow) => workflow.name !== "ci-complete",
  );
  const completion = pipeline.workflows.find(
    (workflow) => workflow.name === "ci-complete",
  );
  const othersFinished =
    otherWorkflows.length > 0 &&
    otherWorkflows.every((workflow) => (workflow.finished ?? 0) > 0);
  return {
    pipelineNumber: pipeline.number,
    attempt: pipeline.rerun_count ?? 0,
    elapsedSeconds: range === null ? null : range.end - range.start,
    withoutActiveWorkflowSeconds:
      range === null || !activityKnown
        ? null
        : range.end - range.start - occupied,
    // The pipeline API does not expose dependency edges. Advisory work can
    // finish after the actual prerequisites, so this is only a lower bound.
    completionDelayLowerBoundSeconds:
      othersFinished && (completion?.started ?? 0) > 0
        ? Math.max(
            0,
            (completion?.started ?? 0) -
              Math.max(
                ...otherWorkflows.map((workflow) => workflow.finished ?? 0),
              ),
          )
        : null,
    workflows,
    limitations:
      "Woodpecker phase durations include admission and pod startup. Workflow start delays include dependency waiting. Overlapping phases must not be summed as pipeline wall time; absent timestamps remain unknown. Live durations use the local clock and are clamped to zero when it is behind the server. Completion delay is a lower bound because the API does not identify the required dependencies.",
  };
}

function seconds(value: number | null): string {
  return value === null ? "unknown" : `${Math.round(value).toString()}s`;
}

export function formatTiming(
  timing: ReturnType<typeof pipelineTiming>,
): string {
  return [
    `Pipeline elapsed: ${seconds(timing.elapsedSeconds)}; without an active workflow: ${seconds(timing.withoutActiveWorkflowSeconds)}`,
    ...timing.workflows.map(
      (workflow) =>
        `  ${workflow.name}: start delay ${seconds(workflow.startDelaySeconds)}, elapsed ${seconds(workflow.elapsedSeconds)} (${workflow.state})`,
    ),
    timing.limitations,
  ].join("\n");
}
