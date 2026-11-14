import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  PromotionRunRowSchema,
  PromotionRunSummarySchema,
  type PromotionRunRow,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { SourceGroups } from "./source-groups.tsx";

function row(overrides: Partial<PromotionRunRow> = {}) {
  return PromotionRunRowSchema.parse({
    targetId: "pmc",
    name: "Planet Minecraft",
    platform: "PMC",
    url: "https://example.com/",
    health: "working",
    outcome: "done",
    reason: "Completed and confirmed",
    detail: "The bump was verified.",
    initialDetail: null,
    intervention: null,
    knownGood: true,
    receiptUrl: null,
    evidenceId: null,
    nextAllowedAt: "2026-11-15T12:34:00Z",
    ...overrides,
  });
}

function render(rows: PromotionRunRow[]) {
  return renderToStaticMarkup(
    createElement(SourceGroups, {
      summary: PromotionRunSummarySchema.parse({
        batchId: null,
        scope: "all",
        startedAt: null,
        finishedAt: null,
        status: "attention",
        followUpCount: 0,
        counts: {
          done: 0,
          notDue: 0,
          disabled: 0,
          errors: 0,
          interventions: 0,
          running: 0,
          queued: 0,
          notRun: 0,
        },
        rows,
      }),
      onHistory: vi.fn(),
    }),
  );
}

it("shows distinct run, success and planned timestamps even after a failure", () => {
  const html = render([
    row({
      health: "error",
      outcome: "error",
      reason: "Latest attempt failed",
      timing: {
        lastRunAt: "2026-11-14T18:00:00Z",
        lastSuccessAt: "2026-11-13T23:00:00Z",
        nextPlannedAt: "2026-11-16T00:00:00Z",
        nextPlannedReason: "Daily posting window",
      },
    }),
  ]);
  expect(html).toContain('<th scope="col">Last run</th>');
  expect(html).toContain('<th scope="col">Last success</th>');
  expect(html).toContain('<th scope="col">Next planned</th>');
  expect(html).toContain('scope="row"');
  expect(html).toContain('dateTime="2026-11-14T18:00:00Z"');
  expect(html).toContain('dateTime="2026-11-13T23:00:00Z"');
  expect(html).toContain('dateTime="2026-11-16T00:00:00Z"');
  expect(html).toContain("4:00 PM PST");
  expect(html).toContain('title="Daily posting window"');
  expect(html).not.toContain('class="p-muted">Daily posting window');
  expect(html).toContain('data-label="Last run"');
  expect(html).toContain('data-label="Last success"');
  expect(html).toContain('data-label="Next planned"');
  expect(html).toContain("Latest attempt failed");
  expect(html).toContain("Details and receipt");
});

it("keeps all timing columns on disabled and waiting sources with explicit empty states", () => {
  const html = render([
    row({
      targetId: "disabled-source",
      health: "disabled",
      outcome: "disabled",
      timing: {
        lastRunAt: null,
        lastSuccessAt: null,
        nextPlannedAt: null,
        nextPlannedReason: "Not enabled",
      },
    }),
    row({
      outcome: "not_due",
      timing: {
        lastRunAt: "2026-11-14T18:00:00Z",
        lastSuccessAt: "2026-11-13T23:00:00Z",
        nextPlannedAt: null,
        nextPlannedReason: "Schedule paused",
      },
    }),
  ]);
  expect(html.match(/<th scope="col">Next planned<\/th>/g)).toHaveLength(2);
  expect(html).toContain("Not recorded");
  expect(html).toContain("No confirmed success");
  expect(html).toContain("Not enabled");
  expect(html).toContain("Schedule paused");
  expect(html).not.toContain('dateTime="2026-11-15T12:34:00Z"');
});

it("shows unavailable timing for an older producer rather than treating cooldown as a plan", () => {
  const html = render([row()]);
  expect(html.match(/>Unavailable<\/span>/g)).toHaveLength(3);
  expect(html).not.toContain("Not recorded");
  expect(html).not.toContain("No confirmed success");
  expect(html).not.toContain('dateTime="2026-11-15T12:34:00Z"');
});
