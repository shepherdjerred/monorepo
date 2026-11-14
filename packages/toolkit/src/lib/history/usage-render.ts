import type {
  HistoryApiBlock,
  HistoryApiBlockGap,
  HistoryApiBlocksResponse,
  HistoryApiUsageReportResponse,
  HistoryApiUsageTotals,
  UsageBreakdown,
} from "./api/report-schema.ts";

/** Human tables for `toolkit history usage --period` and `history blocks`. */

type Cell = { readonly text: string; readonly right?: boolean };

function table(headers: readonly Cell[], rows: readonly Cell[][]): string[] {
  const widths = headers.map((header, column) =>
    Math.max(
      header.text.length,
      ...rows.map((row) => row[column]?.text.length ?? 0),
    ),
  );
  const line = (cells: readonly Cell[]): string =>
    cells
      .map((cell, column) => {
        const width = widths[column] ?? 0;
        return (headers[column]?.right ?? false)
          ? cell.text.padStart(width)
          : cell.text.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map((row) => line(row))];
}

function tokens(value: number): string {
  return value.toLocaleString("en-US");
}

/** A partial cost is a lower bound, marked with `+`. */
function cost(value: number, complete: boolean): string {
  return `$${value.toFixed(2)}${complete ? "" : "+"}`;
}

const TOKEN_HEADERS: readonly Cell[] = [
  { text: "Input", right: true },
  { text: "Output", right: true },
  { text: "Cache read", right: true },
  { text: "Cache write", right: true },
  { text: "Total", right: true },
  { text: "Cost", right: true },
];

function tokenCells(totals: HistoryApiUsageTotals): Cell[] {
  return [
    tokens(totals.inputTokens),
    tokens(totals.outputTokens),
    tokens(totals.cacheReadTokens),
    tokens(totals.cacheCreationTokens),
    tokens(totals.totalTokens),
    cost(totals.costUsd, totals.costComplete),
  ].map((text) => ({ text }));
}

const DIMENSION_HEADERS: Record<UsageBreakdown, string> = {
  agent: "Agent",
  model: "Model",
  project: "Project",
  machine: "Machine",
};

function dimensionText(
  dimension: UsageBreakdown,
  value: string | null,
): string {
  if (value !== null) {
    return value;
  }
  return dimension === "machine" ? "local" : "-";
}

export function renderUsageReport(
  report: HistoryApiUsageReportResponse,
): string {
  const weekNote =
    report.period === "week" ? `, weeks start ${report.startOfWeek}` : "";
  const lines = [
    `## Token usage by ${report.period} (${report.timezone}${weekNote})`,
    "",
  ];
  if (report.periods.length === 0) {
    lines.push("No usage in this range.");
    return lines.join("\n");
  }
  const blankDimensions = report.breakdown.map(() => ({ text: "" }));
  const rows: Cell[][] = [];
  for (const period of report.periods) {
    rows.push([
      { text: period.period },
      ...blankDimensions,
      ...tokenCells(period),
    ]);
    for (const row of period.breakdown) {
      rows.push([
        { text: "" },
        ...report.breakdown.map((dimension) => ({
          text: dimensionText(dimension, row[dimension]),
        })),
        ...tokenCells(row),
      ]);
    }
  }
  rows.push([
    { text: "Total" },
    ...blankDimensions,
    ...tokenCells(report.total),
  ]);
  lines.push(
    ...table(
      [
        { text: "Period" },
        ...report.breakdown.map((dimension) => ({
          text: DIMENSION_HEADERS[dimension],
        })),
        ...TOKEN_HEADERS,
      ],
      rows,
    ),
  );
  if (report.total.unpricedModels.length > 0) {
    lines.push(
      "",
      `Unpriced models (costs marked + are lower bounds): ${report.total.unpricedModels.join(", ")}`,
    );
  }
  return lines.join("\n");
}

const timeFormat = new Intl.DateTimeFormat("en-CA", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localTime(iso: string): string {
  return timeFormat.format(new Date(iso)).replace(",", "");
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${String(hours)}h ${String(rest)}m` : `${String(rest)}m`;
}

function blockStatus(block: HistoryApiBlock): string {
  if (!block.isActive) {
    return "done";
  }
  return block.alignedToQuota ? "active (quota)" : "active";
}

type TimelineEntry =
  | { readonly kind: "block"; readonly value: HistoryApiBlock }
  | { readonly kind: "gap"; readonly value: HistoryApiBlockGap };

function timeline(response: HistoryApiBlocksResponse): TimelineEntry[] {
  const order = new Map(
    response.blocks.map((block, index) => [block.agent, index]),
  );
  return [
    ...response.blocks.map((value) => ({ kind: "block" as const, value })),
    ...response.gaps.map((value) => ({ kind: "gap" as const, value })),
  ].toSorted(
    (a, b) =>
      (order.get(a.value.agent) ?? 0) - (order.get(b.value.agent) ?? 0) ||
      a.value.start.localeCompare(b.value.start),
  );
}

function machineScope(machine: string): string {
  if (machine === "local") {
    return "this machine";
  }
  return machine === "all" ? "all machines" : `machine ${machine}`;
}

export function renderBlocks(response: HistoryApiBlocksResponse): string {
  const lines = [
    `## 5-hour usage blocks (${machineScope(response.machine)}${response.since === null ? "" : `, since ${localTime(response.since)}`})`,
    "",
  ];
  if (response.blocks.length === 0) {
    lines.push(
      response.activeOnly ? "No active blocks." : "No usage in this range.",
    );
    return lines.join("\n");
  }
  const rows = timeline(response).map((entry): Cell[] =>
    entry.kind === "gap"
      ? [
          { text: entry.value.agent },
          { text: localTime(entry.value.start) },
          { text: localTime(entry.value.end) },
          { text: "gap" },
          { text: "" },
          { text: "" },
          { text: "" },
        ]
      : [
          { text: entry.value.agent },
          { text: localTime(entry.value.start) },
          { text: localTime(entry.value.end) },
          { text: blockStatus(entry.value) },
          { text: entry.value.models.join(", ") },
          { text: tokens(entry.value.totalTokens) },
          { text: cost(entry.value.costUsd, entry.value.costComplete) },
        ],
  );
  lines.push(
    ...table(
      [
        { text: "Agent" },
        { text: "Start" },
        { text: "End" },
        { text: "Status" },
        { text: "Models" },
        { text: "Tokens", right: true },
        { text: "Cost", right: true },
      ],
      rows,
    ),
  );
  for (const block of response.blocks) {
    const projection = block.projection;
    if (projection === null) {
      continue;
    }
    lines.push(
      "",
      `${block.agent}: ${duration(projection.remainingMinutes)} left; ` +
        `${tokens(Math.round(projection.tokensPerMinute))} tokens/min, ` +
        `${cost(projection.costPerHour, block.costComplete)}/h; ` +
        `projected ${tokens(projection.projectedTokens)} tokens, ` +
        `${cost(projection.projectedCostUsd, block.costComplete)} at ${localTime(block.end)}`,
    );
  }
  return lines.join("\n");
}
