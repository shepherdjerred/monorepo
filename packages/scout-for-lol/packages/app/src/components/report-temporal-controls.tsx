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
                    update({
                      ...base,
                      window: {
                        kind: "calendar",
                        startDate: event.target.value,
                        endDate: calendarWindow.endDate,
                      },
                    });
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
                    update({
                      ...base,
                      window: {
                        kind: "calendar",
                        startDate: calendarWindow.startDate,
                        endDate: event.target.value,
                      },
                    });
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
                    update({
                      ...base,
                      comparison: {
                        kind: "calendar",
                        startDate: event.target.value,
                        endDate: calendarComparison.endDate,
                      },
                    });
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
                    update({
                      ...base,
                      comparison: {
                        kind: "calendar",
                        startDate: calendarComparison.startDate,
                        endDate: event.target.value,
                      },
                    });
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

function comparisonFor(
  analysis: TemporalAnalysisSpec,
  value: string,
): TemporalAnalysisSpec["comparison"] {
  if (value === "none") return undefined;
  if (value === "previous_period") return { kind: "previous_period" };
  if (value !== "calendar") {
    throw new Error(`Unknown temporal comparison ${value}.`);
  }
  const days =
    analysis.window.kind === "relative"
      ? analysis.window.days
      : Math.round(
          (Date.parse(analysis.window.endDate) -
            Date.parse(analysis.window.startDate)) /
            86_400_000,
        ) + 1;
  const currentStart =
    analysis.window.kind === "calendar"
      ? Date.parse(analysis.window.startDate)
      : Date.now() - (days - 1) * 86_400_000;
  const end = new Date(currentStart - 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return {
    kind: "calendar",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
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

function withRange(
  analysis: TemporalAnalysisSpec,
  range: RangeChoice,
): TemporalAnalysisSpec {
  if (range !== "custom") {
    return { ...analysis, window: { kind: "relative", days: Number(range) } };
  }
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    ...analysis,
    window: { kind: "calendar", startDate: start, endDate: today },
  };
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
