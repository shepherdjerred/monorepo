import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  QUERY_ERROR_RETRY_MS,
  QUERY_STALE_TIME_MS,
  refetchApiUrl,
  resetQueryCacheForTests,
  revalidateApiUrlIfStale,
  subscribeToApiQuery,
  useApiQuery,
} from "./api.ts";
import { App } from "./app.tsx";
import { ResponsiveTable, SortableTh } from "./components/sortable-table.tsx";
import {
  formatSortAnnouncement,
  nextSortState,
  sortItems,
  type ColumnAccessor,
} from "./sort.ts";

type SampleRow = {
  readonly label: string;
  readonly score: number;
};

const SAMPLE_ACCESSORS: Readonly<
  Record<"label" | "score", ColumnAccessor<SampleRow>>
> = {
  label: { kind: "text", getValue: (row) => row.label },
  score: { kind: "number", getValue: (row) => row.score },
};

describe("accessible table sorting and shell landmarks", () => {
  test("starts ascending on new column and toggles direction on repeat click", () => {
    const first = nextSortState<"label" | "score">(null, "score");
    expect(first).toEqual({ column: "score", direction: "ascending" });

    const second = nextSortState(first, "score");
    expect(second).toEqual({ column: "score", direction: "descending" });

    const switched = nextSortState(second, "label");
    expect(switched).toEqual({ column: "label", direction: "ascending" });
  });

  test("sorts text with natural numeric Intl.Collator and numbers numerically", () => {
    const rows: readonly SampleRow[] = [
      { label: "Wave 10", score: 100 },
      { label: "Wave 2", score: 25 },
      { label: "wave 1", score: 250 },
    ];

    const byLabelAsc = sortItems(
      rows,
      { column: "label", direction: "ascending" },
      SAMPLE_ACCESSORS,
    );
    expect(byLabelAsc.map((row) => row.label)).toEqual([
      "wave 1",
      "Wave 2",
      "Wave 10",
    ]);

    const byScoreDesc = sortItems(
      rows,
      { column: "score", direction: "descending" },
      SAMPLE_ACCESSORS,
    );
    expect(byScoreDesc.map((row) => row.score)).toEqual([250, 100, 25]);

    expect(formatSortAnnouncement("Best Wave", "descending", 1)).toBe(
      "Sorted by Best Wave, descending, 1 row",
    );
    expect(formatSortAnnouncement("Best Wave", "ascending", 8)).toBe(
      "Sorted by Best Wave, ascending, 8 rows",
    );
  });

  test("renders accessible global shell landmarks and omits staff navigation for public viewers", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('href="#page-heading"');
    expect(html).toContain("Skip to main content");
    expect(html).toContain('aria-label="Primary"');
    expect(html).not.toContain('aria-label="Primary navigation"');
    expect(html).toContain('id="page-heading"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("/staff/network");
    expect(html).not.toContain("STAFF · TAILNET");
  });

  test("renders mobile sort controls for sortable tables and omits them for static tables", () => {
    const noop = vi.fn();
    const sortableHtml = renderToStaticMarkup(
      <ResponsiveTable caption="Top warriors">
        <thead>
          <tr>
            <SortableTh
              label="Warrior"
              direction="ascending"
              onActivate={noop}
            />
            <SortableTh label="PvP Kills" numeric onActivate={noop} />
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Alice</th>
            <td data-label="PvP Kills">12</td>
          </tr>
        </tbody>
      </ResponsiveTable>,
    );
    expect(sortableHtml).toContain("table-mobile-sort");
    expect(sortableHtml).toContain('aria-label="Sort Top warriors"');
    expect(sortableHtml).toContain("Toggle Warrior sort direction");

    const staticHtml = renderToStaticMarkup(
      <ResponsiveTable caption="Recent feed">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Event</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Now</th>
            <td data-label="Event">Slain</td>
          </tr>
        </tbody>
      </ResponsiveTable>,
    );
    expect(staticHtml).not.toContain("table-mobile-sort");
  });

  test("expires cached API responses after QUERY_STALE_TIME_MS", async () => {
    resetQueryCacheForTests();
    vi.useFakeTimers();
    let calls = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        calls += 1;
        return Response.json({ count: calls });
      });

    const schema = z.object({ count: z.number() });
    function Probe() {
      const { state } = useApiQuery("/api/v1/test-live", schema);
      return (
        <span>{state.status === "success" ? state.data.count : "loading"}</span>
      );
    }

    try {
      vi.setSystemTime(new Date("2026-11-22T20:00:00Z"));
      revalidateApiUrlIfStale("/api/v1/test-live", schema);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(1);
      expect(renderToStaticMarkup(<Probe />)).toContain("loading");

      // Within QUERY_STALE_TIME_MS, non-forced revalidation reuses cached success
      vi.setSystemTime(
        new Date(
          Date.parse("2026-11-22T20:00:00Z") + QUERY_STALE_TIME_MS - 1000,
        ),
      );
      revalidateApiUrlIfStale("/api/v1/test-live", schema);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(1);

      // Past QUERY_STALE_TIME_MS, non-forced revalidation refreshes automatically
      vi.setSystemTime(
        new Date(
          Date.parse("2026-11-22T20:00:00Z") + QUERY_STALE_TIME_MS + 1000,
        ),
      );
      revalidateApiUrlIfStale("/api/v1/test-live", schema);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(2);
    } finally {
      fetchSpy.mockRestore();
      resetQueryCacheForTests();
      vi.useRealTimers();
    }
  });

  test("throttles failed query retries across resubscriptions until cooldown or manual refetch", async () => {
    resetQueryCacheForTests();
    vi.useFakeTimers();
    let calls = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        calls += 1;
        return Response.json({ error: "Player not found" }, { status: 404 });
      });

    const schema = z.object({ name: z.string() });
    try {
      vi.setSystemTime(new Date("2026-11-22T20:00:00Z"));
      const unsubFirst = subscribeToApiQuery(
        "/api/v1/players/unknown",
        schema,
        () => {
          // Listener registered
        },
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(1);
      unsubFirst();

      // Immediate resubscription must not loop-fetch a 404 within QUERY_ERROR_RETRY_MS
      const unsubSecond = subscribeToApiQuery(
        "/api/v1/players/unknown",
        schema,
        () => {
          // Resubscribed within error retry window
        },
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(1);

      // Explicit manual refetch bypasses error cooldown immediately
      refetchApiUrl("/api/v1/players/unknown", schema);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(2);

      // Past QUERY_ERROR_RETRY_MS, background revalidation retries cleanly
      vi.setSystemTime(
        new Date(
          Date.parse("2026-11-22T20:00:00Z") + QUERY_ERROR_RETRY_MS + 1000,
        ),
      );
      revalidateApiUrlIfStale("/api/v1/players/unknown", schema);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(3);
      unsubSecond();
    } finally {
      fetchSpy.mockRestore();
      resetQueryCacheForTests();
      vi.useRealTimers();
    }
  });
});
