import { createHash } from "node:crypto";
import { Context } from "@temporalio/activity";
import { ReportEnvelopeV1Schema } from "#shared/reports/report.ts";
import type { PromotionState } from "#shared/promotion/model.ts";
import type { promotionAiAccounting } from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";
import type { SweepSummary } from "./reddit-outreach/sweep-audit.ts";

export function promotionAlertFingerprint(
  state: PromotionState,
): string | null {
  return state.blockedReason === null
    ? null
    : createHash("sha256")
        .update(
          `${state.targetId}:${state.lastOccurrenceId ?? "unowned"}:${state.blockedReason}`,
        )
        .digest("hex");
}

export function promotionReport(
  states: readonly PromotionState[],
  solverMicrousd: number,
  alertFingerprint?: string,
  ai?: ReturnType<typeof promotionAiAccounting>,
) {
  const now = new Date().toISOString();
  const info = Context.current().info;
  if (info.workflowExecution === undefined)
    throw new Error("Promotion reports require a Workflow-owned Activity");
  const blocked = states.filter((state) => state.blockedReason !== null);
  const uninspected = states.filter((state) => state.checkedAt === null);
  return ReportEnvelopeV1Schema.parse({
    schemaVersion: 1,
    reportRunId:
      alertFingerprint === undefined
        ? `storm-promotion/daily/${now.slice(0, 10)}`
        : `storm-promotion/alert/${alertFingerprint}`,
    reportType: "storm-promotion",
    scheduleId: "the-storm-promotion-daily",
    title:
      alertFingerprint === undefined
        ? "The Storm promotion summary"
        : "The Storm promotion needs attention",
    startedAt: now,
    completedAt: now,
    execution: uninspected.length > 0 ? "partial" : "complete",
    verdict:
      blocked.length > 0
        ? "attention"
        : uninspected.length > 0
          ? "inconclusive"
          : "clear",
    headline: `${String(states.length)} destinations tracked; ${String(blocked.length)} blocked. Solver spending or reservations this month: $${(solverMicrousd / 1_000_000).toFixed(2)}.${ai === undefined ? "" : ` AI today: $${ai.aiUsd.toFixed(5)} recorded + $${ai.allocatedAiUsd.toFixed(5)} reviewed budget allocation; ${String(ai.unknownAi)} exact costs unknown (${String(ai.unallocatedUnknownAi)} unallocated).`}`,
    checks: states.map((state) => ({
      id: state.targetId,
      label: state.targetId,
      required: true,
      status:
        state.blockedReason === null
          ? state.checkedAt === null
            ? "skipped"
            : "passed"
          : "failed",
      summary:
        state.blockedReason ??
        `${state.paused ? "Paused" : "Ready"}; saved schedule deadline: ${state.nextEligibleAt ?? "not set"}.`,
      evidenceReceiptIds: [state.targetId],
    })),
    evidence: states.map((state) => ({
      id: state.targetId,
      source: "Durable promotion ledger",
      observedAt: now,
      status: "success",
      excerpt: JSON.stringify({
        lastAttempt: state.attempts.at(-1),
        nextEligibleAt: state.nextEligibleAt,
        lock: state.lock,
        paused: state.paused,
        checkedAt: state.checkedAt,
      }).slice(0, 2000),
    })),
    findings: blocked.map((state) => ({
      id: state.targetId,
      severity: "warning",
      summary: state.blockedReason,
      evidenceReceiptIds: [state.targetId],
    })),
    limitations: [
      "A stored receipt proves only the recorded action. The caller selects actions and timing; a dry run does not prove publication.",
    ],
    actions: blocked.map(
      (state) =>
        `Inspect ${state.targetId}: toolkit promotion status ${state.targetId}; reconcile uncertain submissions before resuming.`,
    ),
    provenance: {
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      source: "The Storm promotion ledger and solver reservations",
    },
  });
}

export function includeRedditOutreachReport(
  report: ReturnType<typeof promotionReport>,
  day: string,
  sweeps: readonly SweepSummary[],
) {
  const latest = sweeps.at(-1);
  if (latest === undefined) return report;
  const inspected = sweeps.reduce((sum, sweep) => sum + sweep.inspected, 0);
  const assessed = sweeps.reduce((sum, sweep) => sum + sweep.assessed, 0);
  const cached = sweeps.reduce((sum, sweep) => sum + sweep.cached, 0);
  const replies = sweeps.flatMap((sweep) => sweep.replies);
  const failures = sweeps.flatMap((sweep) => sweep.failures);
  const accountHolds = [
    ...new Set(
      sweeps
        .map((sweep) => sweep.stopReason)
        .filter((reason) => reason === "logged-out" || reason === "challenge"),
    ),
  ];
  const blocked =
    accountHolds.length > 0 ||
    failures.length > 0 ||
    replies.some((reply) => reply.status === "blocked");
  const accountSummary =
    accountHolds.length === 0
      ? ""
      : ` Reddit account requires operator restoration (${accountHolds.join(", ")}).`;
  report.checks.push({
    id: "reddit-outreach",
    label: `Reddit outreach (${day} Pacific)`,
    required: true,
    status: blocked ? "failed" : "passed",
    summary: `${String(inspected)} inspected, ${String(assessed)} assessed, ${String(cached)} cached, ${String(replies.length)} reply outcomes.${accountSummary}`,
    evidenceReceiptIds: ["reddit-outreach"],
  });
  report.evidence.push({
    id: "reddit-outreach",
    source: "Durable Reddit outreach sweep ledger",
    observedAt: latest.completedAt,
    status: "success",
    excerpt: JSON.stringify({
      accountHolds,
      blockers: failures.slice(-4),
      replies: replies
        .filter((reply) => reply.receiptUrl !== undefined)
        .map(({ postId, receiptUrl }) => ({ postId, receiptUrl })),
    }).slice(0, 2000),
  });
  if (blocked) report.verdict = "attention";
  return report;
}
