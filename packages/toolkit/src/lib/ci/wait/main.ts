import { isFailure } from "#lib/ci/status.ts";
import { mainVerdict, type MainRunSnapshot } from "#lib/ci/main.ts";
import type { Verdict } from "#lib/ci/readiness.ts";
import type { LoopResult } from "./wait.ts";
import type { CiObserver } from "#lib/ci/observer.ts";
import { pipelineDiagnostics } from "#lib/ci/diagnostics.ts";
import { diagnosticText, summarizePipeline } from "#lib/ci/output.ts";
import { formatTiming, pipelineTiming } from "#lib/ci/timing.ts";

const short = (sha: string) => sha.slice(0, 12);

/** Judge the pinned main commit's own verifying run. */
export function evaluateMainRun(snapshot: MainRunSnapshot): Verdict {
  const moved =
    snapshot.tipSha === snapshot.sha
      ? []
      : [
          `Main has advanced to ${short(snapshot.tipSha)}; this verdict is for ${short(snapshot.sha)}.`,
        ];
  const run = snapshot.run;
  if (run === null)
    return {
      outcome: "waiting",
      reasons: [
        `No verifying main pipeline exists for ${short(snapshot.sha)} yet.`,
        ...moved,
      ],
      commands: [],
    };
  const state = mainVerdict(run, null);
  if (state === "red")
    return {
      outcome: "failure",
      reasons: [
        `Main pipeline #${String(run.number)} failed for ${short(snapshot.sha)}.`,
        ...run.workflows
          .filter((workflow) => isFailure(workflow.state))
          .map((workflow) => `${workflow.name} failed`),
        ...moved,
      ],
      commands: [],
    };
  if (state === "green")
    return {
      outcome: "ready",
      reasons: [
        `Main pipeline #${String(run.number)} passed for ${short(snapshot.sha)}.`,
        ...moved,
      ],
      commands: [],
    };
  return {
    outcome: "waiting",
    reasons: [
      `Main pipeline #${String(run.number)} is ${run.status}; long queues and builds are expected.`,
      ...moved,
    ],
    commands: ["toolkit ci load"],
  };
}

export async function mainWaitReport(
  result: LoopResult<MainRunSnapshot>,
  observer: CiObserver,
  signal?: AbortSignal,
) {
  const snapshot = result.snapshot;
  const run = snapshot?.run ?? null;
  const diagnostics =
    result.verdict.outcome === "failure"
      ? await pipelineDiagnostics(
          run,
          observer.woodpecker,
          [observer.github.token],
          signal,
        )
      : [];
  signal?.throwIfAborted();
  return {
    outcome: result.verdict.outcome,
    ready: result.verdict.outcome === "ready",
    target: "main" as const,
    sha: snapshot?.sha ?? null,
    tipSha: snapshot?.tipSha ?? null,
    pipeline: summarizePipeline(run, observer),
    workflows:
      run?.workflows.map((workflow) => ({
        name: workflow.name,
        state: workflow.state,
      })) ?? [],
    timing: run === null ? null : pipelineTiming(run),
    blockers: result.verdict.reasons,
    diagnostics,
    commands: [
      ...result.verdict.commands,
      ...diagnostics.map((diagnostic) => diagnostic.command),
    ],
    elapsedMs: result.elapsedMs,
  };
}

export function formatMainWait(
  report: Awaited<ReturnType<typeof mainWaitReport>>,
): string {
  return [
    `${report.outcome.toUpperCase()} main @ ${short(report.sha ?? "")}`,
    ...report.blockers,
    ...(report.timing === null ? [] : [formatTiming(report.timing)]),
    ...report.diagnostics.map((diagnostic) => diagnosticText(diagnostic)),
    ...report.commands,
  ].join("\n");
}
