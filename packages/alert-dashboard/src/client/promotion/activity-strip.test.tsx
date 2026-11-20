import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  PromotionSourceActivitySchema,
  type PromotionSourceActivity,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { ActivityLegend, ActivityStrip } from "./activity-strip.tsx";

type Day = PromotionSourceActivity["days"][number];

function strip(
  days: Partial<Day>[],
  runDetailFrom: string | null = "2026-11-01",
) {
  return renderToStaticMarkup(
    createElement(ActivityStrip, {
      activity: PromotionSourceActivitySchema.parse({
        startDay: "2026-11-01",
        runDetailFrom,
        days: days.map((day) => ({
          posts: 0,
          failures: 0,
          noAction: 0,
          ...day,
        })),
      }),
      name: "Planet Minecraft",
      onHistory: vi.fn(),
    }),
  );
}

const cells = (html: string) =>
  [...html.matchAll(/<span class="(p-day[^"]*)" title="([^"]*)">/g)].map(
    (match) => [match[1], match[2]],
  );

it("draws one cell per day, filled by posts and outlined by failures", () => {
  const html = strip([
    {},
    { posts: 1 },
    { posts: 2 },
    { posts: 7 },
    { failures: 2 },
    { posts: 1, failures: 1 },
    { noAction: 1 },
    { noAction: 2, failures: 1 },
  ]);
  expect(cells(html)).toEqual([
    ["p-day p-day-none", "Nov 1: No activity"],
    ["p-day p-day-post-1", "Nov 2: 1 post"],
    ["p-day p-day-post-2", "Nov 3: 2 posts"],
    ["p-day p-day-post-3", "Nov 4: 7 posts"],
    ["p-day p-day-fail", "Nov 5: 2 failed runs"],
    ["p-day p-day-post-1 p-day-fail", "Nov 6: 1 post, 1 failed run"],
    ["p-day p-day-idle", "Nov 7: 1 run posted nothing"],
    ["p-day p-day-fail", "Nov 8: 1 failed run, 2 runs posted nothing"],
  ]);
});

it("marks empty days before the oldest retained run as unrecorded, not quiet", () => {
  expect(cells(strip([{}, { posts: 1 }, {}, {}], "2026-11-03"))).toEqual([
    ["p-day p-day-gap", "Nov 1: No run records kept"],
    ["p-day p-day-post-1", "Nov 2: 1 post"],
    ["p-day p-day-none", "Nov 3: No activity"],
    ["p-day p-day-none", "Nov 4: No activity"],
  ]);
  // No retained runs at all means nothing ran, so empty days are simply quiet.
  expect(cells(strip([{}], null))).toEqual([
    ["p-day p-day-none", "Nov 1: No activity"],
  ]);
});

it("is one link to the source history, named by its visible totals", () => {
  const html = strip([
    { posts: 2 },
    { posts: 1, failures: 1 },
    { noAction: 1 },
  ]);
  expect(html).toContain('<a class="p-activity" href="#promotion-history">');
  expect(html).toContain('<span class="p-activity-days" aria-hidden="true">');
  expect(html).toContain(
    '<span class="sr-only">Planet Minecraft, last 3 days: </span>' +
      '<span class="p-activity-summary">3 posts · 1 failed · 1 posted nothing</span>' +
      '<span class="sr-only">. View history</span>',
  );
  expect(strip([{}, {}])).toContain(
    '<span class="p-activity-summary">No activity</span>',
  );
  expect(strip([{ posts: 1 }])).toContain(
    '<span class="p-activity-summary">1 post</span>',
  );
});

it("says unavailable when the producer does not report activity", () => {
  expect(
    renderToStaticMarkup(
      createElement(ActivityStrip, {
        activity: undefined,
        name: "Planet Minecraft",
        onHistory: vi.fn(),
      }),
    ),
  ).toBe('<span class="p-muted">Unavailable</span>');
});

it("explains every cell state in the legend", () => {
  const html = renderToStaticMarkup(createElement(ActivityLegend));
  for (const state of ["post-1", "post-3", "fail", "idle", "none", "gap"])
    expect(html).toContain(`p-day p-day-${state}`);
});
