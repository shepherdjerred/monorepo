import { expect, it } from "vitest";
import type {
  PromotionBatch,
  PromotionHistoryEntry,
  PromotionOverview,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { promotionRunSummary } from "@shepherdjerred/ops-model/promotion/summary.ts";

type Source = PromotionOverview["sources"][number];
type Batch = PromotionOverview["batches"][number];

it("shows the second failed execution as failed and automatically paused", () => {
  const summary = promotionRunSummary({
    sources: [
      source("login", {
        constraint: "Automatically paused after 2 consecutive failures",
      }),
    ],
    batches: [
      batch("full", [
        entry("login", { phase: "blocked", summary: "Credentials missing" }),
      ]),
    ],
    history: [],
  });
  expect(summary.rows[0]).toMatchObject({
    health: "disabled",
    outcome: "error",
    reason: "Automatically paused after 2 consecutive failures",
  });
  expect(summary.status).toBe("attention");
});

it("distinguishes an observed disabled cooldown button from a failed cooldown check", () => {
  const summary = promotionRunSummary({
    sources: [
      source("native", { nextAllowedAt: "2026-11-10T01:00:00Z" }),
      source("failed"),
    ],
    batches: [
      batch("full", [
        entry("native", { phase: "blocked" }),
        entry("failed", { phase: "verified" }),
      ]),
    ],
    history: [
      report("native", "full", {
        status: "blocked",
        summary:
          "The native control is disabled: Bump server on cooldown; no deadline was supplied.",
      }),
      report("failed", "full", {
        status: "failed",
        summary: "Failed while checking cooldown: request timed out",
      }),
    ],
  });
  expect(summary.rows[0]).toMatchObject({
    health: "working",
    outcome: "not_due",
    nextAllowedAt: null,
  });
  expect(summary.rows[1]).toMatchObject({ health: "error", outcome: "error" });
});

it("shows an active follow-up instead of reusing the original success", () => {
  const summary = promotionRunSummary({
    sources: [source("a")],
    batches: [
      batch("full", [entry("a")]),
      batch("retry", [entry("a", { status: "running", phase: "Checking" })], {
        scope: "selected",
        startedAt: "2026-11-09T02:00:00Z",
        finishedAt: null,
      }),
    ],
    history: [report("a", "full")],
  });
  expect(summary.status).toBe("running");
  expect(summary.rows[0]?.outcome).toBe("running");
});

function source(id: string, changes: Partial<Source> = {}): Source {
  return {
    id,
    name: id,
    platform: "Server list",
    url: "https://example.com/",
    action: "bump",
    notes: "",
    constraint: "",
    nextAllowedAt: null,
    latest: null,
    preview: null,
    lastAction: null,
    ...changes,
  };
}
function entry(
  targetId: string,
  changes: Partial<PromotionBatch["entries"][number]> = {},
): PromotionBatch["entries"][number] {
  return {
    targetId,
    status: "completed",
    phase: "verified",
    summary: "Confirmed",
    startedAt: "2026-11-09T01:00:00Z",
    finishedAt: "2026-11-09T01:01:00Z",
    occurrenceId: `local/${targetId}`,
    ...changes,
  };
}
function batch(
  id: string,
  entries: Batch["entries"],
  changes: Partial<Batch> = {},
): Batch {
  return {
    version: 1,
    id,
    pid: 123,
    mode: "run",
    scope: "all",
    startedAt: "2026-11-09T01:00:00Z",
    updatedAt: "2026-11-09T01:02:00Z",
    finishedAt: "2026-11-09T01:02:00Z",
    interrupted: false,
    entries,
    ...changes,
  };
}
function report(
  targetId: string,
  batchId: string,
  changes: Partial<PromotionHistoryEntry> = {},
): PromotionHistoryEntry {
  return {
    id: `${batchId}/${targetId}`,
    batchId,
    targetId,
    mode: "run",
    status: "verified",
    summary: "Confirmed",
    at: "2026-11-09T01:01:00Z",
    timeBasis: "execution",
    finishedAt: "2026-11-09T01:01:00Z",
    occurrenceId: `local/${targetId}`,
    receiptUrl: "https://example.com/receipt",
    evidenceId: null,
    costUsd: null,
    cleanup: null,
    ...changes,
  };
}

it("separates normal cooldowns, missing setup, and errors on proven sources", () => {
  const sources = [
    source("good"),
    source("waiting"),
    source("setup", { action: "pending" }),
    source("login"),
  ];
  const full = batch("full", [
    entry("good", { phase: "blocked" }),
    entry("waiting", {
      status: "skipped",
      phase: "cooldown",
      summary: "Cooldown",
    }),
    entry("setup", { status: "skipped", phase: "pending" }),
    entry("login", { phase: "blocked" }),
  ]);
  const summary = promotionRunSummary({
    sources,
    batches: [full],
    history: [
      report("good", "old"),
      report("waiting", "old"),
      report("login", "old"),
      report("good", "full", {
        status: "blocked",
        summary: "Request timed out",
      }),
      report("login", "full", {
        status: "blocked",
        summary: "Stored login rejected",
      }),
    ],
  });
  expect(summary.status).toBe("attention");
  expect(summary.rows.map(({ health, outcome }) => [health, outcome])).toEqual([
    ["error", "error"],
    ["working", "not_due"],
    ["disabled", "disabled"],
    ["error", "error"],
  ]);
});

it("counts verified retries and corrections as success while retaining recovery history", () => {
  const full = batch("full", [
    entry("pmc", { phase: "blocked", summary: "Browser failed" }),
    entry("ad"),
  ]);
  const retry = batch("retry", [entry("pmc")], {
    scope: "selected",
    startedAt: "2026-11-09T02:00:00Z",
  });
  const correction = batch(
    "correction",
    [entry("ad", { phase: "copy-corrected" })],
    { scope: "selected", startedAt: "2026-11-09T03:00:00Z" },
  );
  const summary = promotionRunSummary({
    sources: [source("pmc"), source("ad")],
    batches: [correction, retry, full],
    history: [
      report("pmc", "full", { status: "blocked", summary: "Browser failed" }),
      report("ad", "full"),
      report("pmc", "retry"),
      report("ad", "correction"),
    ],
  });
  expect(summary.batchId).toBe("full");
  expect(summary.status).toBe("passed");
  expect(summary.rows.every((row) => row.health === "working")).toBe(true);
  expect(
    summary.rows.every((row) => row.reason === "Completed and confirmed"),
  ).toBe(true);
  expect(summary.counts).toMatchObject({
    done: 2,
    errors: 0,
    interventions: 2,
  });
  expect(summary.rows.map((row) => row.intervention)).toEqual([
    "retried",
    "corrected",
  ]);
  expect(summary.rows[0]?.initialDetail).toBe("Browser failed");
});

it("does not let a preview erase a live failure or cleanup failure appear successful", () => {
  const full = batch("full", [
    entry("pmc", { phase: "blocked" }),
    entry("disboard-native-bump"),
  ]);
  const preview = batch("preview", [entry("pmc", { phase: "preview" })], {
    mode: "preview",
    scope: "selected",
    startedAt: "2026-11-09T02:00:00Z",
  });
  const summary = promotionRunSummary({
    sources: [source("pmc"), source("disboard-native-bump")],
    batches: [preview, full],
    history: [
      report("pmc", "full", { status: "blocked" }),
      report("pmc", "preview", { mode: "preview", status: "preview" }),
      report("disboard-native-bump", "full", {
        cleanup: "blocked: Missing permission",
      }),
    ],
  });
  expect(summary.counts.errors).toBe(2);
  expect(summary.counts.done).toBe(0);
  expect(summary.rows[1]?.reason).toContain("cleanup failed");
});

it("does not interpret a generic completed task with a blocked phase as success", () => {
  const summary = promotionRunSummary({
    sources: [source("pmc")],
    batches: [batch("full", [entry("pmc", { phase: "blocked" })])],
    history: [],
  });
  expect(summary.status).toBe("attention");
  expect(summary.rows[0]?.outcome).toBe("error");
});

it("shows a failed credential check as an error while keeping missing implementation disabled", () => {
  const manual = report("login", "manual", {
    mode: "unknown",
    timeBasis: "attempt",
    occurrenceId: "manual/login",
  });
  const summary = promotionRunSummary({
    sources: [
      source("login", { lastAction: manual }),
      source("inspect", { action: "inspect" }),
    ],
    batches: [
      batch("full", [
        entry("login", { phase: "blocked", summary: "Credentials missing" }),
        entry("inspect", { phase: "preview" }),
      ]),
    ],
    history: [manual],
  });
  expect(summary.rows.map((row) => row.health)).toEqual(["error", "disabled"]);
  expect(summary.rows[0]?.knownGood).toBe(false);
});

it("ignores an older interrupted selected run and reports active full-run progress", () => {
  const old = batch(
    "old",
    [entry("pmc", { status: "running", phase: "Starting" })],
    {
      scope: "selected",
      startedAt: "2026-11-08T01:00:00Z",
      finishedAt: null,
      interrupted: true,
    },
  );
  const full = batch("full", [entry("pmc")]);
  const input = { sources: [source("pmc")], batches: [old, full], history: [] };
  expect(promotionRunSummary(input).status).toBe("passed");
  expect(
    promotionRunSummary({
      ...input,
      batches: [
        old,
        {
          ...full,
          finishedAt: null,
          entries: [entry("pmc", { status: "running", phase: "Starting" })],
        },
      ],
    }).status,
  ).toBe("running");
});

it("infers legacy full runs only from exact coverage and honors explicit selected scope", () => {
  const legacy = batch("legacy", [entry("a"), entry("b")]);
  delete legacy.scope;
  const selected = batch("selected", [entry("a"), entry("b")], {
    scope: "selected",
    startedAt: "2026-11-09T02:00:00Z",
  });
  expect(
    promotionRunSummary({
      sources: [source("a"), source("b")],
      batches: [selected, legacy],
      history: [],
    }).batchId,
  ).toBe("legacy");
});
