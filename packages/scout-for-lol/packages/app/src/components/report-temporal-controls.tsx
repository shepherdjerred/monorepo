import {
  TemporalAnalysisSpecSchema,
  reportTemporalAnalysis,
  replaceReportTemporalAnalysis,
  type TemporalAnalysisSpec,
  type TemporalBucket,
} from "@scout-for-lol/data";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";

type RangeChoice = "30" | "90" | "365" | "custom";

export function ReportTemporalControls(props: {
  queryText: string;
  scheduleTimezone: string;
  onChange: (queryText: string) => void;
}) {
  const current = safeAnalysis(props.queryText);
  const enabled = current !== null;
  const base =
    current ??
    TemporalAnalysisSpecSchema.parse({
      window: { kind: "relative", days: 30 },
      bucket: "auto",
      timezone: props.scheduleTimezone,
    });
  const update = (analysis: TemporalAnalysisSpec | null) => {
    props.onChange(replaceReportTemporalAnalysis(props.queryText, analysis));
  };
  const calendarWindow = base.window.kind === "calendar" ? base.window : null;
  const calendarComparison =
    base.comparison?.kind === "calendar" ? base.comparison : null;

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            update(event.target.checked ? base : null);
          }}
        />
        Analyze results over time
      </label>
      {enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="font-medium">Period</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2"
              value={rangeChoice(base)}
              onChange={(event) => {
                update(withRange(base, parseRangeChoice(event.target.value)));
              }}
            >
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last 365 days</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">Bucket</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2"
              value={base.bucket}
              onChange={(event) => {
                update({ ...base, bucket: parseBucket(event.target.value) });
              }}
            >
              <option value="auto">Automatic</option>
              <option value="day">Day</option>
              <option value="week">ISO week</option>
              <option value="month">Month</option>
              <option value="patch">Patch</option>
            </select>
          </label>
          {calendarWindow !== null && (
            <>
              <div className="space-y-1">
                <Label htmlFor="analysis-start">Start date</Label>
                <Input
                  id="analysis-start"
                  type="date"
                  value={calendarWindow.startDate}
                  onChange={(event) => {
                    if (event.target.value === "") return;
                    update(
                      withCalendarWindowBoundary(
                        base,
                        "startDate",
                        event.target.value,
                      ),
                    );
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="analysis-end">End date</Label>
                <Input
                  id="analysis-end"
                  type="date"
                  value={calendarWindow.endDate}
                  onChange={(event) => {
                    if (event.target.value === "") return;
                    update(
                      withCalendarWindowBoundary(
                        base,
                        "endDate",
                        event.target.value,
                      ),
                    );
                  }}
                />
              </div>
            </>
          )}
          <label className="space-y-1 text-xs">
            <span className="font-medium">Comparison</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2"
              value={base.comparison?.kind ?? "none"}
              onChange={(event) => {
                update({
                  ...base,
                  comparison: comparisonFor(base, event.target.value),
                });
              }}
            >
              <option value="none">No comparison</option>
              <option value="previous_period">Previous equal period</option>
              <option value="calendar">Custom equal-length baseline</option>
            </select>
          </label>
          <div className="space-y-1">
            <Label htmlFor="analysis-timezone">Analysis timezone</Label>
            <select
              id="analysis-timezone"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={base.timezone}
              onChange={(event) => {
                update({ ...base, timezone: event.target.value });
              }}
            >
              {timezoneOptions(base.timezone).map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </div>
          {calendarComparison !== null && (
            <>
              <div className="space-y-1">
                <Label htmlFor="comparison-start">Baseline start</Label>
                <Input
                  id="comparison-start"
                  type="date"
                  value={calendarComparison.startDate}
                  onChange={(event) => {
                    if (event.target.value === "") return;
                    update(
                      withCalendarComparisonBoundary(
                        base,
                        "startDate",
                        event.target.value,
                      ),
                    );
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="comparison-end">Baseline end</Label>
                <Input
                  id="comparison-end"
                  type="date"
                  value={calendarComparison.endDate}
                  onChange={(event) => {
                    if (event.target.value === "") return;
                    update(
                      withCalendarComparisonBoundary(
                        base,
                        "endDate",
                        event.target.value,
                      ),
                    );
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
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

export function comparisonFor(
  analysis: TemporalAnalysisSpec,
  value: string,
  now: Date = new Date(),
): TemporalAnalysisSpec["comparison"] {
  if (value === "none") return undefined;
  if (value === "previous_period") return { kind: "previous_period" };
  if (value !== "calendar") {
    throw new Error(`Unknown temporal comparison ${value}.`);
  }
  const days = temporalWindowDays(analysis);
  const currentStart =
    analysis.window.kind === "calendar"
      ? analysis.window.startDate
      : shiftCalendarDate(
          calendarDateInTimezone(now, analysis.timezone),
          1 - days,
        );
  const end = shiftCalendarDate(currentStart, -1);
  return {
    kind: "calendar",
    startDate: shiftCalendarDate(end, 1 - days),
    endDate: end,
  };
}

function safeAnalysis(queryText: string): TemporalAnalysisSpec | null {
  try {
    return reportTemporalAnalysis(queryText);
  } catch {
    return null;
  }
}

function rangeChoice(analysis: TemporalAnalysisSpec): RangeChoice {
  if (analysis.window.kind !== "relative") return "custom";
  const days = analysis.window.days.toString();
  return days === "30" || days === "90" || days === "365" ? days : "custom";
}

export function withRange(
  analysis: TemporalAnalysisSpec,
  range: RangeChoice,
  now: Date = new Date(),
): TemporalAnalysisSpec {
  if (range !== "custom") {
    return withTemporalWindow(analysis, {
      kind: "relative",
      days: Number(range),
    });
  }
  const today = calendarDateInTimezone(now, analysis.timezone);
  const start = shiftCalendarDate(today, -29);
  return withTemporalWindow(analysis, {
    kind: "calendar",
    startDate: start,
    endDate: today,
  });
}

export function withCalendarWindowBoundary(
  analysis: TemporalAnalysisSpec,
  boundary: "startDate" | "endDate",
  value: string,
): TemporalAnalysisSpec {
  if (analysis.window.kind !== "calendar") {
    throw new Error("Calendar window controls require a calendar window.");
  }
  const window =
    boundary === "startDate"
      ? {
          kind: "calendar" as const,
          startDate: value,
          endDate:
            value > analysis.window.endDate ? value : analysis.window.endDate,
        }
      : {
          kind: "calendar" as const,
          startDate:
            value < analysis.window.startDate
              ? value
              : analysis.window.startDate,
          endDate: value,
        };
  return withTemporalWindow(analysis, window);
}

export function withCalendarComparisonBoundary(
  analysis: TemporalAnalysisSpec,
  boundary: "startDate" | "endDate",
  value: string,
): TemporalAnalysisSpec {
  if (analysis.comparison?.kind !== "calendar") {
    throw new Error("Calendar comparison controls require a custom baseline.");
  }
  const days = temporalWindowDays(analysis);
  return {
    ...analysis,
    comparison:
      boundary === "startDate"
        ? {
            kind: "calendar",
            startDate: value,
            endDate: shiftCalendarDate(value, days - 1),
          }
        : {
            kind: "calendar",
            startDate: shiftCalendarDate(value, 1 - days),
            endDate: value,
          },
  };
}

function withTemporalWindow(
  analysis: TemporalAnalysisSpec,
  window: TemporalAnalysisSpec["window"],
): TemporalAnalysisSpec {
  const next = { ...analysis, window };
  if (analysis.comparison?.kind !== "calendar") return next;
  const days = temporalWindowDays(next);
  return {
    ...next,
    comparison: {
      kind: "calendar",
      startDate: analysis.comparison.startDate,
      endDate: shiftCalendarDate(analysis.comparison.startDate, days - 1),
    },
  };
}

function temporalWindowDays(analysis: TemporalAnalysisSpec): number {
  return analysis.window.kind === "relative"
    ? analysis.window.days
    : Math.round(
        (Date.parse(analysis.window.endDate) -
          Date.parse(analysis.window.startDate)) /
          86_400_000,
      ) + 1;
}

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
    throw new Error(`Could not format temporal controls in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}

function parseRangeChoice(value: string): RangeChoice {
  if (
    value === "30" ||
    value === "90" ||
    value === "365" ||
    value === "custom"
  ) {
    return value;
  }
  throw new Error(`Unknown temporal range ${value}.`);
}

function parseBucket(value: string): TemporalBucket {
  if (
    value === "auto" ||
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "patch"
  ) {
    return value;
  }
  throw new Error(`Unknown temporal bucket ${value}.`);
}
