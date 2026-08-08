import { describe, expect, test } from "bun:test";
import {
  applyEventLine,
  applySpanLine,
  createRunView,
  sortedTimeline,
} from "./fold.ts";

const HASH = "0".repeat(64);

function eventLine(fields: {
  sequence: number;
  timestamp: string;
  kind: string;
  correlation?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    runId: "run-1",
    sequence: fields.sequence,
    timestamp: fields.timestamp,
    previousHash: HASH,
    kind: fields.kind,
    correlation: fields.correlation ?? {},
    payload: fields.payload ?? {},
    hash: HASH,
  });
}

const EMPTY_SNAPSHOT = {
  open: 1,
  green: 0,
  active: 1,
  queued: 0,
  pending: 0,
  waiting: 0,
  paused: 0,
  prs: [],
};

const OPERATOR_REQUEST = {
  id: "request-42",
  pr: 42,
  headSha: "a".repeat(40),
  generation: 1,
  context: "Two valid fixes imply different ownership.",
  questions: [
    {
      id: "ownership",
      header: "Ownership",
      question: "Which change belongs to this PR?",
      options: [
        {
          id: "include",
          label: "Include it",
          description: "The paths match the PR scope.",
          recommended: true,
        },
        {
          id: "exclude",
          label: "Exclude it",
          description: "The paths belong to separate work.",
          recommended: false,
        },
      ],
    },
  ],
  createdAt: "2026-08-08T20:00:00.000Z",
};

const WAITING_PR = {
  identity: {
    number: 42,
    title: "Waiting PR",
    url: "https://github.com/shepherdjerred/monorepo/pull/42",
    draft: false,
    author: "shepherdjerred",
    labels: [],
    headRefName: "feature/waiting-pr",
    headSha: "a".repeat(40),
    baseRefName: "main",
    crossRepository: false,
    maintainerCanModify: true,
  },
  logicalOwner: "pr-42",
  runtimeAgent: null,
  agentGeneration: 1,
  model: "openai/gpt-5.6-terra",
  status: "waiting-for-answer",
  classification: "waiting-for-answer",
  stackId: "pr-42",
  worktree: "/tmp/worktrees/pr-42",
  worktreeContext: null,
  setupComplete: true,
  evidence: {
    headSha: "a".repeat(40),
    checks: [],
    buildkiteCurrentHead: true,
    buildkiteFailure: null,
    conflict: false,
    reviewFindings: [],
    hostedReviewComplete: false,
    hardFailureFingerprint: null,
    reviewFingerprint: null,
  },
  lastAgentReportAt: "2026-08-08T20:00:00.000Z",
  lastProgressAt: "2026-08-08T20:00:00.000Z",
  noProgressTicks: 0,
  prodSentAt: null,
  escalation: null,
  operatorRequest: OPERATOR_REQUEST,
  priority: 0,
};

describe("fold", () => {
  test("captures the latest fleet snapshot from fleet.snapshot", () => {
    const view = createRunView();
    applyEventLine(
      view,
      eventLine({
        sequence: 1,
        timestamp: "2026-08-03T20:00:00.000Z",
        kind: "fleet.snapshot",
        payload: { snapshot: { ...EMPTY_SNAPSHOT, open: 3 } },
      }),
    );
    expect(view.fleet?.open).toBe(3);
  });

  test("extracts the snapshot nested inside a tick.completed report", () => {
    const view = createRunView();
    applyEventLine(
      view,
      eventLine({
        sequence: 1,
        timestamp: "2026-08-03T20:00:00.000Z",
        kind: "tick.completed",
        payload: {
          report: {
            trigger: "startup",
            snapshot: { ...EMPTY_SNAPSHOT, green: 2 },
            changes: [],
            nextHeartbeatSeconds: 300,
          },
        },
      }),
    );
    expect(view.fleet?.green).toBe(2);
  });

  test("buckets events by PR and keeps fleet-level events separate", () => {
    const view = createRunView();
    applyEventLine(
      view,
      eventLine({
        sequence: 1,
        timestamp: "2026-08-03T20:00:01.000Z",
        kind: "worker.attempt.started",
        correlation: { prNumber: 1389 },
        payload: { attempt: 1, prompt: "work" },
      }),
    );
    applyEventLine(
      view,
      eventLine({
        sequence: 2,
        timestamp: "2026-08-03T20:00:02.000Z",
        kind: "master.text",
        payload: { text: "hello" },
      }),
    );
    expect(view.prs.get(1389)?.timeline).toHaveLength(1);
    expect(view.fleetTimeline).toHaveLength(1);
  });

  test("folds waiting state and operator-question events into the affected PR", () => {
    const view = createRunView();
    applyEventLine(
      view,
      eventLine({
        sequence: 1,
        timestamp: "2026-08-08T20:00:00.000Z",
        kind: "fleet.snapshot",
        payload: {
          snapshot: {
            ...EMPTY_SNAPSHOT,
            active: 0,
            waiting: 1,
            prs: [WAITING_PR],
          },
        },
      }),
    );
    applyEventLine(
      view,
      eventLine({
        sequence: 2,
        timestamp: "2026-08-08T20:00:01.000Z",
        kind: "operator.question.asked",
        correlation: {
          prNumber: 42,
          headSha: OPERATOR_REQUEST.headSha,
          generation: 1,
        },
        payload: { request: OPERATOR_REQUEST },
      }),
    );

    expect(view.fleet?.waiting).toBe(1);
    expect(view.fleet?.prs[0]?.operatorRequest?.id).toBe("request-42");
    const item = view.prs.get(42)?.timeline[0];
    expect(item?.kind).toBe("event");
    if (item?.kind !== "event") {
      throw new Error("Expected a folded operator question event");
    }
    expect(item.event.kind).toBe("operator.question.asked");
  });

  test("joins a span to its PR via metadata.prNumber and dedupes by span id", () => {
    const view = createRunView();
    const span = {
      kind: "span",
      span: {
        id: "span-1",
        traceId: "trace-1",
        name: "model generation",
        type: "model_generation",
        endTime: "2026-08-03T20:00:03.000Z",
        input: { messages: [] },
        output: { text: "reasoning" },
        metadata: { prNumber: 1389 },
      },
    };
    applySpanLine(view, JSON.stringify(span));
    applySpanLine(view, JSON.stringify(span));
    expect(view.prs.get(1389)?.timeline).toHaveLength(1);
    expect(view.prs.get(1389)?.timeline[0]?.kind).toBe("span");
  });

  test("marks the run failed on run.failed", () => {
    const view = createRunView();
    applyEventLine(
      view,
      eventLine({
        sequence: 1,
        timestamp: "2026-08-03T20:00:00.000Z",
        kind: "run.failed",
        payload: {
          status: "failed",
          finishedAt: "2026-08-03T20:00:00.000Z",
          durationMs: 1,
        },
      }),
    );
    expect(view.runStatus).toBe("failed");
  });

  test("sortedTimeline orders by event time then arrival", () => {
    const view = createRunView();
    applyEventLine(
      view,
      eventLine({
        sequence: 1,
        timestamp: "2026-08-03T20:00:05.000Z",
        kind: "fleet.change",
        correlation: { prNumber: 7 },
        payload: { change: "later" },
      }),
    );
    applySpanLine(
      view,
      JSON.stringify({
        kind: "span",
        span: {
          id: "s",
          traceId: "t",
          name: "x",
          type: "tool_call",
          endTime: "2026-08-03T20:00:01.000Z",
          metadata: { prNumber: 7 },
        },
      }),
    );
    const ordered = sortedTimeline(view.prs.get(7)?.timeline ?? []);
    expect(ordered[0]?.kind).toBe("span");
    expect(ordered[1]?.kind).toBe("event");
  });
});
