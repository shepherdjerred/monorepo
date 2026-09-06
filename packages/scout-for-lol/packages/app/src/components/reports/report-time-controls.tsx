import { match } from "ts-pattern";
import { analyzeScoutQl } from "@scout-for-lol/data/model/scoutql/analyze.ts";
import {
  applyReportTimeSpec,
  readReportTimeSpec,
  type ReportTimeSpec,
  type ReportTimeWindow,
} from "@scout-for-lol/data/model/scoutql/report-time-spec.ts";
import type { ReportTimeBucket } from "@scout-for-lol/data/model/scoutql/report-time-spec-bucket.ts";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Label } from "@scout-for-lol/design-system/components/label";

// ── The report's time controls ───────────────────────────────────────────────
// Period, bucket, comparison and time zone are all facets of the QUERY, so
// every control here reads the query text and writes the query text back
// through `applyReportTimeSpec`. Nothing is mirrored into component state: the
// text is the single representation, which is why an unrelated clause can
// never be lost to a control the user never touched.
//
// When the query is one the controls cannot represent — it has errors, its
// source is a point-in-time snapshot, or its time filter is hand-written in a
// shape no control produces — they render disabled with the reason, rather
// than accepting a click that would silently do nothing.

const RELATIVE_PERIOD_DAYS: readonly number[] = [7, 14, 30, 90, 365];
const DEFAULT_CALENDAR_DAYS = 30;

export type TimeControlsState =
  | { kind: "ready"; spec: ReportTimeSpec }
  | { kind: "disabled"; reason: string };

/**
 * What the controls should show for `queryText`, or why they cannot apply.
 *
 * `readReportTimeSpec` answers only "spec or not"; the reason comes from one
 * more analysis pass, run solely on the unrepresentable path.
 */
export function timeControlsState(queryText: string): TimeControlsState {
  const spec = readReportTimeSpec(queryText);
  if (spec !== undefined) {
    return { kind: "ready", spec };
  }
  const analysis = analyzeScoutQl(queryText);
  if (
    analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return {
      kind: "disabled",
      reason:
        "The query has errors. Fix them in the editor and these controls come back.",
    };
  }
  return {
    kind: "disabled",
    reason: match(analysis.timeWindow)
      .with(
        { kind: "snapshot" },
        () =>
          "This source is a point-in-time snapshot, so there is no history to bound or bucket.",
      )
      .with(
        { kind: "bounded" },
        () =>
          "This query's time filter is hand-written. Edit it in the query so it is kept exactly as you wrote it.",
      )
      .otherwise(() => "The time controls do not apply to this query."),
  };
}

// ── Period ───────────────────────────────────────────────────────────────────

export type PeriodChoice =
  | { kind: "relative"; days: number }
  | { kind: "calendar" }
  | { kind: "all-history" };

export function periodChoice(spec: ReportTimeSpec): string {
  return match(spec.window)
    .with({ kind: "relative" }, (window) => window.days.toString())
    .with({ kind: "calendar" }, () => "calendar")
    .with({ kind: "all-history" }, () => "all-history")
    .exhaustive();
}

export function parsePeriodChoice(value: string): PeriodChoice {
  if (value === "calendar") {
    return { kind: "calendar" };
  }
  if (value === "all-history") {
    return { kind: "all-history" };
  }
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`Unknown report period choice "${value}".`);
  }
  return { kind: "relative", days };
}

/** The relative choices offered, including a query's own unusual span. */
function relativePeriodDays(spec: ReportTimeSpec): number[] {
  const current = spec.window.kind === "relative" ? [spec.window.days] : [];
  return [...new Set([...RELATIVE_PERIOD_DAYS, ...current])].toSorted(
    (left, right) => left - right,
  );
}

export function withPeriod(
  spec: ReportTimeSpec,
  choice: PeriodChoice,
  now: Date = new Date(),
): ReportTimeSpec {
  const window = match(choice)
    .with({ kind: "relative" }, (relative): ReportTimeWindow => ({
      kind: "relative",
      days: relative.days,
    }))
    .with({ kind: "all-history" }, (): ReportTimeWindow => ({
      kind: "all-history",
    }))
    .with({ kind: "calendar" }, (): ReportTimeWindow => {
      // Seed custom dates from the span the user is leaving, so switching to
      // "Custom dates" shows the same period rather than an arbitrary one.
      const end = calendarDateInTimezone(now, spec.timezone);
      const days =
        spec.window.kind === "relative"
          ? spec.window.days
          : DEFAULT_CALENDAR_DAYS;
      return {
        kind: "calendar",
        start: shiftCalendarDate(end, 1 - days),
        end,
        timezone: spec.timezone,
      };
    })
    .exhaustive();
  // Comparison needs a bounded window to take the preceding period of, so an
  // "All history" period atomically turns it off — leaving it checked would
  // insert `compare = previous_period` into an unbounded query, which the
  // analyzer refuses (see `compareAvailable`).
  return {
    ...spec,
    window,
    compare: window.kind === "all-history" ? false : spec.compare,
  };
}

/**
 * Whether the "Compare with the previous period" control can be turned on:
 * `compare = previous_period` needs both a bounded window and a temporal
 * bucket to line the two periods up (analyze-render-shape.ts's
 * `checkCompare`). Read this before rendering the checkbox `checked`/enabled,
 * not after — an already-checked box left enabled through an incompatible
 * period or bucket change would silently turn a valid report into invalid
 * ScoutQL the next time the query is written out.
 */
export function compareAvailable(spec: ReportTimeSpec): boolean {
  return spec.window.kind !== "all-history" && spec.bucket !== null;
}

export function withCalendarBoundary(
  spec: ReportTimeSpec,
  boundary: "start" | "end",
  value: string,
): ReportTimeSpec {
  if (spec.window.kind !== "calendar") {
    throw new Error("Calendar date controls require a calendar period.");
  }
  const window = spec.window;
  // Dragging one endpoint past the other would produce an empty range, so the
  // other endpoint follows rather than the range inverting.
  const next: ReportTimeWindow =
    boundary === "start"
      ? {
          kind: "calendar",
          start: value,
          end: value > window.end ? value : window.end,
          timezone: window.timezone,
        }
      : {
          kind: "calendar",
          start: value < window.start ? value : window.start,
          end: value,
          timezone: window.timezone,
        };
  return { ...spec, window: next };
}

// ── Bucket ───────────────────────────────────────────────────────────────────

export function parseBucketChoice(value: string): ReportTimeBucket | null {
  if (value === "none") {
    return null;
  }
  if (
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "patch"
  ) {
    return value;
  }
  throw new Error(`Unknown report time bucket "${value}".`);
}

export function withBucket(
  spec: ReportTimeSpec,
  bucket: ReportTimeBucket | null,
): ReportTimeSpec {
  // Same atomic reset as `withPeriod`: dropping to "No bucket" removes the
  // temporal axis comparison needs, so a query with compare left on would
  // become invalid ScoutQL the next time it is written out.
  return { ...spec, bucket, compare: bucket === null ? false : spec.compare };
}

// ── Time zone ────────────────────────────────────────────────────────────────

/**
 * Whether the zone changes anything: it dates calendar bounds and places
 * DATE_TRUNC boundaries, and does nothing else. A patch bucket is cut by Riot,
 * not by a calendar.
 */
export function timezoneApplies(spec: ReportTimeSpec): boolean {
  return (
    spec.window.kind === "calendar" ||
    (spec.bucket !== null && spec.bucket !== "patch")
  );
}

export function withTimezone(
  spec: ReportTimeSpec,
  timezone: string,
): ReportTimeSpec {
  const window: ReportTimeWindow =
    spec.window.kind === "calendar"
      ? { ...spec.window, timezone }
      : spec.window;
  return { ...spec, window, timezone };
}

function timezoneOptions(current: string): string[] {
  return [
    ...new Set([
      current,
      "UTC",
      "America/Los_Angeles",
      "America/Denver",
      "America/Chicago",
      "America/New_York",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Seoul",
      "Asia/Tokyo",
      "Australia/Sydney",
    ]),
  ];
}

// ── Calendar-date arithmetic ─────────────────────────────────────────────────

function shiftCalendarDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function calendarDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not read today's date in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}

// ── The component ────────────────────────────────────────────────────────────

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-scout-border bg-scout-canvas px-2 disabled:cursor-not-allowed disabled:opacity-50";

export function ReportTimeControls(props: {
  queryText: string;
  onChange: (queryText: string) => void;
}) {
  const state = timeControlsState(props.queryText);
  if (state.kind === "disabled") {
    return (
      <fieldset
        className="space-y-2 rounded-md border border-border p-3 opacity-60"
        disabled
      >
        <legend className="px-1 text-sm font-medium">Time</legend>
        <p className="text-xs text-scout-subtle">{state.reason}</p>
      </fieldset>
    );
  }
  const { spec } = state;
  const update = (next: ReportTimeSpec) => {
    props.onChange(applyReportTimeSpec(props.queryText, next));
  };
  const calendar = spec.window.kind === "calendar" ? spec.window : null;
  const zoneEnabled = timezoneApplies(spec);

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Time</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="font-medium">Period</span>
          <select
            className={SELECT_CLASS}
            value={periodChoice(spec)}
            onChange={(event) => {
              update(withPeriod(spec, parsePeriodChoice(event.target.value)));
            }}
          >
            {relativePeriodDays(spec).map((days) => (
              <option key={days} value={days.toString()}>
                Last {days.toString()} days
              </option>
            ))}
            <option value="calendar">Custom dates</option>
            <option value="all-history">All history</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="font-medium">Bucket</span>
          <select
            className={SELECT_CLASS}
            value={spec.bucket ?? "none"}
            onChange={(event) => {
              update(withBucket(spec, parseBucketChoice(event.target.value)));
            }}
          >
            <option value="none">No bucket</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="patch">Patch</option>
          </select>
        </label>

        {calendar !== null && (
          <>
            <div className="space-y-1">
              <Label htmlFor="report-period-start">Start date</Label>
              <Input
                id="report-period-start"
                type="date"
                value={calendar.start}
                onChange={(event) => {
                  if (event.target.value === "") {
                    return;
                  }
                  update(
                    withCalendarBoundary(spec, "start", event.target.value),
                  );
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-period-end">End date</Label>
              <Input
                id="report-period-end"
                type="date"
                value={calendar.end}
                onChange={(event) => {
                  if (event.target.value === "") {
                    return;
                  }
                  update(withCalendarBoundary(spec, "end", event.target.value));
                }}
              />
            </div>
          </>
        )}

        <label className="space-y-1 text-xs">
          <span className="font-medium">Time zone</span>
          <select
            id="report-period-timezone"
            className={`${SELECT_CLASS} text-sm`}
            value={spec.timezone}
            disabled={!zoneEnabled}
            onChange={(event) => {
              update(withTimezone(spec, event.target.value));
            }}
          >
            {timezoneOptions(spec.timezone).map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </select>
          {!zoneEnabled && (
            <span className="block text-scout-subtle">
              Applies to custom dates and day/week/month buckets.
            </span>
          )}
        </label>

        <label className="flex items-center gap-2 self-end text-xs">
          <input
            type="checkbox"
            className="size-5"
            checked={spec.compare}
            disabled={!compareAvailable(spec)}
            onChange={(event) => {
              update({ ...spec, compare: event.target.checked });
            }}
          />
          <span className="font-medium">Compare with the previous period</span>
        </label>
      </div>

      {!compareAvailable(spec) && (
        <p className="text-xs text-scout-subtle">
          Comparison needs a bounded period and a bucket (day, week, month, or
          patch) to line the two periods up.
        </p>
      )}

      {spec.window.kind === "all-history" && (
        <p className="text-xs text-scout-subtle">
          Every ingested game is included. Pick a period to bound the report.
        </p>
      )}
    </fieldset>
  );
}
