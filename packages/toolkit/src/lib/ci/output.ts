import { pipelineUrl, type WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import { listReviewFeedback } from "#lib/review/feedback.ts";
import { REPOSITORY } from "./github.ts";
import type { CiObserver } from "./observer.ts";
import type { WaitResult } from "./wait.ts";
import type { MainStatus } from "./main.ts";
import { isFailure, workflowStatus } from "./status.ts";
import { requiredChecks } from "./readiness.ts";
import { pipelineDiagnostics, type Diagnostic } from "./diagnostics.ts";
import { sanitizeText } from "./redaction.ts";
import { pipelineTiming, formatTiming } from "./timing.ts";

export function mainFailure(main: MainStatus): WoodpeckerPipeline | null {
  return main.latest !== null &&
    (workflowStatus(main.latest.status) === "UNHEALTHY" ||
      main.latest.workflows.some((workflow) => isFailure(workflow.state)))
    ? main.latest
    : main.lastVerdict;
}

function summarizePipeline(
  pipeline: WoodpeckerPipeline | null,
  observer: CiObserver,
) {
  return pipeline === null
    ? null
    : {
        number: pipeline.number,
        attempt: pipeline.rerun_count ?? 0,
        headSha: pipeline.commit,
        status: pipeline.status,
        url: pipelineUrl(pipeline, observer.woodpecker),
      };
}

export function summarizeMain(main: MainStatus, observer: CiObserver) {
  return {
    state: main.state,
    headSha: main.headSha,
    latest: summarizePipeline(main.latest, observer),
    lastVerdict: summarizePipeline(main.lastVerdict, observer),
  };
}

async function failureReviews(result: WaitResult, observer: CiObserver) {
  const snapshot = result.snapshot;
  const reviewFailed =
    snapshot?.pipeline?.workflows.some(
      (workflow) =>
        workflow.name.includes("review") && isFailure(workflow.state),
    ) === true;
  if (
    snapshot === null ||
    !(reviewFailed || result.verdict.outcome === "human_action")
  )
    return { findings: [], error: null };
  try {
    const reviews = await listReviewFeedback({
      repo: REPOSITORY,
      number: snapshot.pr.number,
      token: observer.github.token,
    });
    return {
      findings: reviews.findings.slice(0, 3).map((finding) => ({
        ...finding,
        contents: sanitizeText(finding.contents, [
          observer.github.token,
          observer.woodpecker.token,
        ]).slice(0, 2000),
        truncated: finding.contents.length > 2000,
      })),
      error: null,
    };
  } catch (error) {
    return {
      findings: [],
      error: sanitizeText(
        `Review evidence unavailable: ${error instanceof Error ? error.message : String(error)}`,
        [observer.github.token, observer.woodpecker.token],
      ),
    };
  }
}

function diagnosticText(diagnostic: Diagnostic): string {
  return `${diagnostic.workflow}${diagnostic.step === null ? "" : ` / ${diagnostic.step}`} exit=${String(diagnostic.exitCode)}\n${diagnostic.error ?? ""}\n${diagnostic.logs}${diagnostic.truncated ? "\n[excerpt truncated]" : ""}\n${diagnostic.url}`;
}

function timingSummary(snapshot: WaitResult["snapshot"]) {
  return snapshot?.pipeline === undefined || snapshot.pipeline === null
    ? null
    : pipelineTiming(snapshot.pipeline);
}

export async function resultReport(
  result: WaitResult,
  observer: CiObserver,
  signal?: AbortSignal,
) {
  const snapshot = result.snapshot;
  const pipeline =
    snapshot !== null && result.verdict.outcome === "main_red"
      ? mainFailure(snapshot.main)
      : (snapshot?.pipeline ?? null);
  const quiet = ["ready", "timeout", "head_changed"].includes(
    result.verdict.outcome,
  );
  const [diagnostics, reviews] = await Promise.all([
    quiet
      ? []
      : pipelineDiagnostics(
          pipeline,
          observer.woodpecker,
          [observer.github.token],
          signal,
        ),
    failureReviews(result, observer),
  ]);
  signal?.throwIfAborted();
  return {
    outcome: result.verdict.outcome,
    ready: result.verdict.outcome === "ready",
    prNumber: snapshot?.pr.number ?? null,
    prUrl: snapshot?.pr.html_url ?? null,
    headSha: snapshot?.pr.head.sha ?? null,
    baseSha: snapshot?.pr.base.sha ?? null,
    pipeline: summarizePipeline(snapshot?.pipeline ?? null, observer),
    checks: snapshot === null ? [] : requiredChecks(snapshot),
    workflows: workflowSummary(snapshot),
    timing: timingSummary(snapshot),
    main: snapshot === null ? null : summarizeMain(snapshot.main, observer),
    blockers: result.verdict.reasons,
    diagnostics,
    reviews,
    commands: [
      ...result.verdict.commands,
      ...diagnostics.map((diagnostic) => diagnostic.command),
    ],
    elapsedMs: result.elapsedMs,
  };
}

function workflowSummary(snapshot: WaitResult["snapshot"]) {
  return (
    snapshot?.pipeline?.workflows.map((workflow) => ({
      name: workflow.name,
      state: workflow.state,
    })) ?? []
  );
}

export function formatResult(
  report: Awaited<ReturnType<typeof resultReport>>,
): string {
  const identity =
    report.prNumber === null
      ? ""
      : ` PR #${String(report.prNumber)} @ ${(report.headSha ?? "").slice(0, 12)}`;
  return [
    `${report.outcome.toUpperCase()}${identity}`,
    ...report.blockers,
    ...(report.timing === null ? [] : [formatTiming(report.timing)]),
    ...report.diagnostics.map((diagnostic) => diagnosticText(diagnostic)),
    ...report.reviews.findings.map(
      (finding) =>
        `${finding.author ?? "deleted author"} ${finding.priority === null ? "P?" : `P${String(finding.priority)}`}\n${finding.contents}\n${finding.rawCommand}`,
    ),
    ...(report.reviews.error === null ? [] : [report.reviews.error]),
    ...report.commands,
  ].join("\n");
}
