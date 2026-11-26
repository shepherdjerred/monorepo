import { renderToStaticMarkup } from "react-dom/server";
import { RocketIcon } from "lucide-react";
import { describe, expect, test } from "vitest";
import { BulkBar } from "@shepherdjerred/console-ui/components/data/bulk-bar.tsx";
import {
  FilterBar,
  describeCount,
  filtersActive,
} from "@shepherdjerred/console-ui/components/data/filter-bar.tsx";
import {
  isTypingTarget,
  nextRowKey,
} from "@shepherdjerred/console-ui/components/data/row-navigation.ts";
import {
  Sparkline,
  computeSparklineGeometry,
} from "@shepherdjerred/console-ui/components/data/sparkline.tsx";
import {
  StackedMeter,
  normalizeSegments,
} from "@shepherdjerred/console-ui/components/data/stacked-meter.tsx";
import { StatusMatrix } from "@shepherdjerred/console-ui/components/data/status-matrix.tsx";
import {
  Timeline,
  dayLabel,
  exactText,
  timeText,
} from "@shepherdjerred/console-ui/components/data/timeline.tsx";
import {
  Meter,
  inferMeterSeverity,
} from "@shepherdjerred/console-ui/components/meter.tsx";

const noop = (): void => {
  // Static rendering never fires events.
};

const usd = (value: number): string => `$${value.toFixed(2)}`;

describe("FilterBar", () => {
  test("describes the count, singular and filtered", () => {
    expect(describeCount(143, 143)).toBe("143 rows");
    expect(describeCount(1, 1, { one: "alert", other: "alerts" })).toBe(
      "1 alert",
    );
    expect(describeCount(12, 143, { one: "alert", other: "alerts" })).toBe(
      "12 of 143 alerts",
    );
  });

  test("is active while a search is typed or a filter is off its default", () => {
    expect(filtersActive({})).toBe(false);
    expect(filtersActive({ search: "  " })).toBe(false);
    expect(filtersActive({ search: "hub" })).toBe(true);
    expect(
      filtersActive({ filters: [{ value: "all", defaultValue: "all" }] }),
    ).toBe(false);
    expect(
      filtersActive({ filters: [{ value: "firing", defaultValue: "all" }] }),
    ).toBe(true);
  });

  test("renders search, filters, a live count, clear and end controls", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        search={{ value: "hub", onChange: noop, label: "Filter alerts" }}
        filters={<span>tabs</span>}
        count={{ shown: 3, total: 9 }}
        active
        onClear={noop}
        end={<button type="button">Export</button>}
      />,
    );
    expect(html).toContain('<div class="ui-toolbar ui-filterbar">');
    expect(html).toContain('<span class="ui-sr-only">Filter alerts</span>');
    expect(html).toContain('value="hub"');
    expect(html).toContain(
      '<div class="ui-filterbar-filters"><span>tabs</span>',
    );
    expect(html).toContain(
      '<span class="ui-filterbar-count" role="status">3 of 9 rows</span>',
    );
    expect(html).toContain("Clear filters");
    expect(html).toContain('class="ui-toolbar-end ui-filterbar-end"');
  });

  test("hides Clear filters when nothing is filtered", () => {
    const html = renderToStaticMarkup(
      <FilterBar count={{ shown: 9, total: 9 }} onClear={noop} />,
    );
    expect(html).not.toContain("Clear filters");
    expect(html).toContain("9 rows");
  });
});

describe("BulkBar", () => {
  test("is a labelled region with the count, actions and clear", () => {
    const html = renderToStaticMarkup(
      <BulkBar
        count={3}
        onClear={noop}
        actions={<button type="button">Silence</button>}
      />,
    );
    expect(html).toContain(
      '<span class="ui-sr-only" role="status">3 selected</span>',
    );
    expect(html).toContain(
      '<div class="ui-bulkbar" role="region" aria-label="Bulk actions">',
    );
    expect(html).toContain("Silence");
    expect(html).toContain("Clear selection");
  });

  test("keeps only its empty live region while nothing is selected", () => {
    expect(renderToStaticMarkup(<BulkBar count={0} onClear={noop} />)).toBe(
      '<span class="ui-sr-only" role="status"></span>',
    );
  });
});

describe("row navigation", () => {
  const keys = ["a", "b", "c"];
  test("moves within the list and clamps at its ends", () => {
    expect(nextRowKey(keys, undefined, 1)).toBe("a");
    expect(nextRowKey(keys, undefined, -1)).toBe("c");
    expect(nextRowKey(keys, "a", 1)).toBe("b");
    expect(nextRowKey(keys, "c", 1)).toBe("c");
    expect(nextRowKey(keys, "a", -1)).toBe("a");
    expect(nextRowKey(keys, "gone", 1)).toBe("a");
    expect(nextRowKey([], undefined, 1)).toBeUndefined();
  });

  test("never treats a missing target as typing", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("Timeline", () => {
  const now = new Date("2026-11-26T20:00:00Z");
  const items = [
    {
      id: "1",
      when: "2026-11-26T18:04:09Z",
      title: "hub deployed",
      detail: "v412 rolled out to 3 pods",
      severity: "ok",
      icon: RocketIcon,
      iconLabel: "Deployed",
      actor: "delivery",
      meta: "2m 14s",
    },
    {
      id: "2",
      when: new Date("2026-11-25T23:30:00Z"),
      title: "Alert fired",
      severity: "error",
    },
    { id: "3", when: "2026-11-20T10:00:00Z", title: "Note added" },
  ] as const;

  test("formats times in Pacific with the exact time on hover", () => {
    const date = new Date("2026-11-26T18:04:09Z");
    expect(timeText(date, "America/Los_Angeles", false)).toBe("10:04");
    expect(timeText(date, "America/Los_Angeles", true)).toBe("Nov 26, 10:04");
    expect(exactText(date, "America/Los_Angeles")).toBe(
      "Thu, Nov 26, 2026, 10:04:09 PST",
    );
    expect(dayLabel(date, now, "America/Los_Angeles")).toBe("Today");
    expect(
      dayLabel(new Date("2026-11-25T23:30:00Z"), now, "America/Los_Angeles"),
    ).toBe("Yesterday");
    expect(
      dayLabel(new Date("2025-03-02T12:00:00Z"), now, "America/Los_Angeles"),
    ).toBe("Sun, Mar 2, 2025");
  });

  test("renders an ordered list with a mono time, marker, title, detail and meta", () => {
    const html = renderToStaticMarkup(
      <Timeline items={items} label="Changes" now={now} />,
    );
    expect(html).toContain(
      '<ol class="ui-timeline" data-density="default" aria-label="Changes">',
    );
    expect(html).toContain(
      '<time class="ui-timeline-time" dateTime="2026-11-26T18:04:09.000Z" title="Thu, Nov 26, 2026, 10:04:09 PST">Nov 26, 10:04</time>',
    );
    // The marker's word stays for screen readers; the icon swaps the glyph.
    expect(html).toContain('data-sev="ok"');
    expect(html).toContain('<span class="ui-sr-only">Deployed</span>');
    expect(html).toContain('<span class="ui-sr-only">Error</span>');
    expect(html).toContain('class="ui-timeline-dot"');
    expect(html).toContain("v412 rolled out to 3 pods");
    expect(html).toContain(
      '<span class="ui-timeline-actor">delivery</span>2m 14s',
    );
  });

  test("groups by day under headings and uses passed-in time text", () => {
    const html = renderToStaticMarkup(
      <Timeline
        items={[{ ...items[0], whenText: "3m ago" }, items[1], items[2]]}
        label="Activity"
        groupByDay
        density="compact"
        now={now}
      />,
    );
    const headings = [
      ...html.matchAll(/<h3 class="ui-timeline-day">([^<]+)<\/h3>/gu),
    ].map((match) => match[1]);
    expect(headings).toEqual(["Today", "Yesterday", "Fri, Nov 20"]);
    expect(html).toContain('aria-label="Activity, Yesterday"');
    expect(html).toContain('data-density="compact"');
    expect(html).toContain(">3m ago</time>");
    expect(html).toContain(">15:30</time>");
  });

  test("says so when empty", () => {
    expect(
      renderToStaticMarkup(
        <Timeline items={[]} label="Changes" emptyMessage="No changes." />,
      ),
    ).toBe('<p class="ui-timeline-empty">No changes.</p>');
  });
});

describe("Sparkline", () => {
  test("handles empty, single-point and flat series without NaN", () => {
    const emptyHtml = renderToStaticMarkup(<Sparkline values={[]} />);
    expect(emptyHtml).toContain('aria-hidden="true"');
    expect(emptyHtml).toContain('width="96"');
    expect(emptyHtml).toContain('height="24"');
    expect(emptyHtml).not.toContain("NaN");
    expect(emptyHtml).not.toContain("<polyline");
    expect(emptyHtml).toContain('class="ui-sparkline-empty"');

    const singleHtml = renderToStaticMarkup(<Sparkline values={[42]} />);
    expect(singleHtml).not.toContain("NaN");
    expect(singleHtml).toContain("<polyline");
    expect(singleHtml).toContain('class="ui-sparkline-dot"');

    const flat = computeSparklineGeometry([7, 7, 7, 7], 96, 24);
    expect(flat.points).toHaveLength(4);
    for (const point of flat.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(point.y).toBe(12);
    }
    const flatHtml = renderToStaticMarkup(
      <Sparkline values={[7, 7, 7, 7]} severity="ok" />,
    );
    expect(flatHtml).not.toContain("NaN");
    expect(flatHtml).toContain('data-sev="ok"');
  });

  test("draws the area, line and latest dot in a severity colour", () => {
    const html = renderToStaticMarkup(
      <Sparkline
        values={[10, Number.NaN, 25, 15, 40]}
        width={120}
        height={28}
        severity="warning"
      />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain('class="ui-sparkline" data-sev="warning"');
    expect(html).toContain('viewBox="0 0 120 28"');
    expect(html).toContain("<linearGradient");
    expect(html).toContain("<path");
    expect(html).toContain('class="ui-sparkline-line"');
    expect(html).toContain('class="ui-sparkline-dot"');
  });

  test("becomes a named image when labelled", () => {
    const html = renderToStaticMarkup(
      <Sparkline values={[1, 2, 3]} label="Requests, last hour: rising" />,
    );
    expect(html).toContain(
      'role="img" aria-label="Requests, last hour: rising"',
    );
    expect(html).not.toContain("aria-hidden");
  });
});

describe("StatusMatrix", () => {
  test("renders a keyboard-scrollable region with a status glyph in every cell", () => {
    const html = renderToStaticMarkup(
      <StatusMatrix
        caption="Backup verification matrix"
        rowHeaderLabel="Dataset"
        columns={[
          { key: "snapshot", label: "Snapshot" },
          { key: "offsite", label: "Offsite" },
          { key: "restore", label: "Restore drill" },
          { key: "audit", label: "Audit" },
          { key: "note", label: "Notes" },
        ]}
        rows={[
          {
            key: "postgres",
            label: "PostgreSQL",
            meta: "daily 02:00 UTC",
            cells: {
              snapshot: { status: "ok", label: "2h ago" },
              offsite: {
                status: "warning",
                label: "29h ago",
                detail: "SLA 24h",
              },
              restore: { status: "error", label: "Failed" },
              note: { status: "info", label: "Pinned" },
            },
          },
        ]}
      />,
    );
    const captionId = /<caption id="([^"]+)"/u.exec(html)?.[1];
    expect(captionId).toBeDefined();
    expect(html).toContain(
      `<div class="ui-table-scroll" role="region" aria-labelledby="${captionId ?? ""}" tabindex="0">`,
    );
    expect(html).toContain('<th scope="row">PostgreSQL');
    expect(html).toContain(
      '<span class="ui-matrix-meta">daily 02:00 UTC</span>',
    );
    // Every status carries its glyph and severity, never colour alone.
    expect(html).toContain('data-sev="ok"');
    expect(html).toContain('data-sev="warning"');
    expect(html).toContain('<span class="ui-sr-only">Warning: </span>29h ago');
    expect(html).toContain('<span class="ui-sr-only"> (SLA 24h)</span>');
    expect(html).toContain('title="SLA 24h"');
    expect(html).toContain('data-sev="error"');
    // "Failed" lacks the word "Error", so the word is read first.
    expect(html).toContain('<span class="ui-sr-only">Error: </span>Failed');
    // An unpopulated column reads as missing.
    expect(html).toContain('data-sev="unknown"');
    expect(html).toContain('<span class="ui-glyph-label">Missing</span>');
    expect(html).toContain("lucide-minus");
    expect(html).toContain('data-sev="info"');
  });

  test("renders an empty message when no rows are supplied", () => {
    const html = renderToStaticMarkup(
      <StatusMatrix
        caption="Empty matrix"
        hideCaption
        columns={[{ key: "health", label: "Health" }]}
        rows={[]}
        emptyMessage="No targets configured."
      />,
    );
    expect(html).toContain('class="ui-sr-only"');
    expect(html).toContain(
      '<tr class="ui-table-empty"><td colSpan="2">No targets configured.',
    );
  });
});

describe("Meter", () => {
  test("infers severity from the reading and projection", () => {
    expect(inferMeterSeverity(null, 100)).toBe("unknown");
    expect(inferMeterSeverity(40, 100)).toBe("ok");
    expect(inferMeterSeverity(86, 100)).toBe("warning");
    expect(inferMeterSeverity(40, 100, 120)).toBe("warning");
    expect(inferMeterSeverity(100, 100)).toBe("error");
  });

  test("a block meter shows label, figure, projection tick and detail", () => {
    const html = renderToStaticMarkup(
      <Meter
        block
        label="Monthly API spend"
        value={86.4}
        max={150}
        format={usd}
        severity="warning"
        projected={162}
        detail="Projected above monthly cap"
      />,
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="Monthly API spend"');
    expect(html).toContain('aria-valuemax="150"');
    expect(html).toContain('aria-valuenow="86.4"');
    expect(html).toContain(
      'aria-valuetext="$86.40 of $150.00 (projected $162.00)"',
    );
    expect(html).toContain('class="ui-meter-projection" style="left:100%"');
    expect(html).toContain('<span class="ui-glyph-label">Warning</span>');
    expect(html).toContain(
      '$86.40<span class="ui-meter-max"> / $150.00</span>',
    );
    expect(html).toContain(
      '<p class="ui-meter-detail">Projected above monthly cap</p>',
    );
  });

  test("an inline meter reads its detail after the value", () => {
    const html = renderToStaticMarkup(
      <Meter label="Disk" value={30} detail="Pruned nightly" />,
    );
    expect(html).toContain('data-sev="ok"');
    expect(html).toContain('aria-valuetext="30%. Pruned nightly"');
  });

  test("handles a missing reading without NaN or a tick", () => {
    const html = renderToStaticMarkup(
      <Meter label="Memory used" value={null} max={100} />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain('data-sev="unknown"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuetext="No data"');
    expect(html).not.toContain("ui-meter-projection");
  });
});

describe("StackedMeter", () => {
  test("splits the track in proportion with a legend of shares", () => {
    const html = renderToStaticMarkup(
      <StackedMeter
        block
        label="Cluster pods by phase"
        segments={[
          { key: "running", label: "Running", value: 75, severity: "ok" },
          { key: "pending", label: "Pending", value: 15, severity: "warning" },
          { key: "failed", label: "Failed", value: 10, severity: "error" },
        ]}
      />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain('data-tone="ok" style="width:75%"');
    expect(html).toContain('data-tone="warning" style="width:15%"');
    expect(html).toContain('data-tone="error" style="width:10%"');
    expect(html).toContain(
      '<ul class="ui-stacked-legend" aria-label="Cluster pods by phase">',
    );
    expect(html).toContain('<span class="ui-stacked-share">75%</span>');
    expect(html).toContain('<span class="ui-meter-reading">100</span>');
  });

  test("handles a zero total without dividing by zero", () => {
    const html = renderToStaticMarkup(
      <StackedMeter
        label="Queue items"
        segments={[
          { key: "queued", label: "Queued", value: 0 },
          { key: "failed", label: "Failed", value: 0 },
        ]}
      />,
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain("0%");
    expect(html).not.toContain("ui-stacked-segment");
    // Inline, the legend is for screen readers only.
    expect(html).toContain('<ul class="ui-sr-only" aria-label="Queue items">');
  });

  test("gives segments without a severity the token series", () => {
    expect(
      normalizeSegments([
        { key: "a", label: "A", value: 1 },
        { key: "b", label: "B", value: 3 },
      ]).segments.map((segment) => [segment.tone, segment.percent]),
    ).toEqual([
      ["accent", 25],
      ["info", 75],
    ]);
  });
});
