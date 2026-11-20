import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  PromotionOverviewSchema,
  type PromotionBatch,
  type PromotionHistoryEntry,
  type PromotionSourceTiming,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { SourceGroups } from "./source-groups.tsx";
import { sourceTimingSummary } from "./source-timing.ts";

function overview() {
  return PromotionOverviewSchema.parse({
    version: 1,
    readAt: "2026-11-14T22:26:32Z",
    scheduling: "scheduled",
    lastRun: {
      batchId: "latest",
      scope: "all",
      startedAt: null,
      finishedAt: null,
      status: "attention",
      followUpCount: 0,
      counts: {
        done: 0,
        notDue: 0,
        disabled: 0,
        errors: 1,
        interventions: 0,
        running: 0,
        queued: 0,
        notRun: 0,
      },
      rows: [
        {
          targetId: "pmc",
          name: "Planet Minecraft",
          platform: "PMC",
          url: "https://example.com/",
          health: "error",
          outcome: "error",
          reason: "Latest attempt failed",
          detail: "Failed",
          initialDetail: null,
          intervention: null,
          knownGood: true,
          receiptUrl: null,
          evidenceId: null,
          nextAllowedAt: "2026-11-15T12:34:00Z",
        },
      ],
    },
    sources: [
      {
        id: "pmc",
        name: "Planet Minecraft",
        platform: "PMC",
        url: "https://example.com/",
        action: "bump",
        notes: "",
        constraint: "",
        nextAllowedAt: "2026-11-15T12:34:00Z",
        latest: null,
        preview: null,
        lastAction: null,
      },
    ],
    batches: [],
    spend: {
      day: "2026-11-14",
      aiUsd: 0,
      captchaUsd: 0,
      pendingCaptchaUsd: 0,
      unknownAi: 0,
    },
  });
}

function batch(changes: Partial<PromotionBatch["entries"][number]> = {}) {
  return {
    version: 1 as const,
    id: "execution",
    pid: 1,
    interrupted: false,
    mode: "run" as const,
    startedAt: "2026-11-14T20:00:00Z",
    updatedAt: "2026-11-14T20:01:00Z",
    finishedAt: "2026-11-14T20:01:00Z",
    entries: [
      {
        targetId: "pmc",
        status: "failed" as const,
        phase: "blocked",
        startedAt: "2026-11-14T20:00:00Z",
        finishedAt: "2026-11-14T20:01:00Z",
        occurrenceId: "execution",
        summary: "Failed",
        ...changes,
      },
    ],
  };
}

function history(
  changes: Partial<PromotionHistoryEntry> = {},
): PromotionHistoryEntry {
  return {
    id: "action",
    batchId: null,
    targetId: "pmc",
    mode: "unknown",
    status: "verified",
    summary: "Verified publishing attempt",
    at: "2026-11-12T12:09:31Z",
    timeBasis: "attempt",
    finishedAt: "2026-11-12T12:09:54Z",
    occurrenceId: "action",
    receiptUrl: null,
    evidenceId: null,
    costUsd: null,
    cleanup: null,
    ...changes,
  };
}

const observed: PromotionSourceTiming = {
  lastRunAt: null,
  lastSuccessAt: null,
  nextPlannedAt: null,
  nextPlannedReason: "Schedule paused",
};

it("renders recorded history from an older worker without presenting cooldown expiry as a plan", () => {
  const data = overview();
  const source = data.sources[0];
  if (!source) throw new Error("Missing fixture source");
  source.lastAction = history();
  source.latest = history({
    status: "failed",
    timeBasis: "execution",
    mode: "run",
    at: "2026-11-14T20:00:00Z",
  });
  data.batches = [
    batch({ startedAt: "2026-11-13T20:00:00Z" }),
    { ...batch(), mode: "preview" },
    batch({ effectiveMode: "reconcile" }),
    batch({ status: "queued", startedAt: null }),
    batch({ status: "skipped", startedAt: null }),
  ];
  const summary = sourceTimingSummary(data);
  expect(summary.rows[0]?.timing).toEqual({
    lastRunAt: "2026-11-13T20:00:00Z",
    lastSuccessAt: "2026-11-12T12:09:54Z",
    nextPlannedAt: null,
    nextPlannedReason: "Schedule data unavailable",
  });
  const html = renderToStaticMarkup(
    createElement(SourceGroups, {
      summary,
      activity: new Map(),
      onHistory: vi.fn(),
    }),
  );
  expect(html).toContain('dateTime="2026-11-13T20:00:00Z"');
  expect(html).toContain('dateTime="2026-11-12T12:09:54Z"');
  expect(html).toContain("Schedule data unavailable");
  // An older worker has no daily activity to show; its timing is still derived.
  expect(html).not.toMatch(
    /class="p-source-timing"[^>]*><span class="p-muted">Unavailable<\/span>/,
  );
  expect(html).toContain(
    'data-label="Last 30 days"><span class="p-muted">Unavailable</span>',
  );
  expect(html).not.toContain('dateTime="2026-11-15T12:34:00Z"');
  expect(data.lastRun.rows[0]?.timing).toBeUndefined();
});

it("counts an execution that started before discovering a cooldown", () => {
  const data = overview();
  data.batches = [batch({ status: "skipped", phase: "cooldown" })];
  expect(sourceTimingSummary(data).rows[0]?.timing?.lastRunAt).toBe(
    "2026-11-14T20:00:00Z",
  );
});

it("preserves authoritative row timing, including nulls, ahead of source timing and history", () => {
  const data = overview();
  const row = data.lastRun.rows[0];
  const source = data.sources[0];
  if (!row || !source) throw new Error("Missing fixture source");
  row.timing = observed;
  source.timing = {
    ...observed,
    nextPlannedAt: "2026-11-16T00:00:00Z",
    nextPlannedReason: "Daily window",
  };
  source.lastAction = history();
  data.batches = [batch()];
  expect(sourceTimingSummary(data).rows[0]?.timing).toEqual(observed);
});

it("uses source timing when a producer has not added timing to summary rows", () => {
  const data = overview();
  const source = data.sources[0];
  if (!source) throw new Error("Missing fixture source");
  source.timing = {
    ...observed,
    nextPlannedAt: "2026-11-16T00:00:00Z",
    nextPlannedReason: "Daily window",
  };
  expect(sourceTimingSummary(data).rows[0]?.timing).toEqual(source.timing);
});

it("uses verified execution history when available but excludes legacy report save times", () => {
  const data = overview();
  const source = data.sources[0];
  if (!source) throw new Error("Missing fixture source");
  source.latest = history({ mode: "run", timeBasis: "execution" });
  expect(sourceTimingSummary(data).rows[0]?.timing?.lastSuccessAt).toBe(
    "2026-11-12T12:09:54Z",
  );
  source.latest = history({ mode: "run", timeBasis: "report-saved" });
  expect(sourceTimingSummary(data).rows[0]?.timing?.lastSuccessAt).toBeNull();
});

it("keeps a manual older payload explicit when no execution or confirmed action is recorded", () => {
  const data = overview();
  data.scheduling = "manual";
  const summary = sourceTimingSummary(data);
  expect(summary.rows[0]?.timing).toEqual({
    lastRunAt: null,
    lastSuccessAt: null,
    nextPlannedAt: null,
    nextPlannedReason: "Manual runs only",
  });
  const html = renderToStaticMarkup(
    createElement(SourceGroups, {
      summary,
      activity: new Map(),
      onHistory: vi.fn(),
    }),
  );
  expect(html).toContain("Not recorded");
  expect(html).toContain("No confirmed success");
  expect(html).toContain("Manual runs only");
});
