import { z } from "zod";
import type { ReportGroupBy } from "#src/model/report-query-spec.ts";
import {
  DEFAULT_RENDER_SPEC,
  ReportChartLabelsSchema,
  ReportChartLegendSchema,
  ReportChartOrientationSchema,
  ReportChartPaletteSchema,
  ReportChartSortSchema,
  ReportChartThemeSchema,
  ReportHexColorSchema,
  ReportRenderSpecSchema,
  type ReportChartOptions,
  type ReportOutputFormat,
  type ReportRenderChannel,
  type ReportRenderSpec,
} from "#src/model/report.ts";

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

const RENDER_KIND_BY_TOKEN: Record<string, ReportOutputFormat> = {
  bar_chart: "BAR_CHART",
  line_chart: "LINE_CHART",
  stacked_bar: "STACKED_BAR",
  area_chart: "AREA_CHART",
  donut_chart: "DONUT_CHART",
  scatter_chart: "SCATTER_CHART",
  heatmap: "HEATMAP",
  radar_chart: "RADAR_CHART",
  kpi_card: "KPI_CARD",
  table: "TABLE",
  list: "LIST",
  leaderboard: "LEADERBOARD",
};

const CHART_RENDER_KINDS = new Set<ReportOutputFormat>([
  "BAR_CHART",
  "LINE_CHART",
  "STACKED_BAR",
  "AREA_CHART",
  "DONUT_CHART",
  "SCATTER_CHART",
  "HEATMAP",
  "RADAR_CHART",
  "KPI_CARD",
]);

const RENDER_WITH_PATTERN = /^with\s*\((?<body>.*)\)$/iu;
const RenderPairSchema = z.object({ key: z.string(), value: z.string() });

export function parseRenderClause(
  clauseText: string | undefined,
  outputColumns: string[],
  groupBys: ReportGroupBy[],
): ReportRenderSpec {
  if (clauseText === undefined || clauseText.length === 0) {
    return DEFAULT_RENDER_SPEC;
  }

  const firstSpace = clauseText.indexOf(" ");
  const kindToken =
    firstSpace === -1 ? clauseText : clauseText.slice(0, firstSpace);
  const withText =
    firstSpace === -1 ? "" : clauseText.slice(firstSpace + 1).trim();
  const kind = RENDER_KIND_BY_TOKEN[normalizeToken(kindToken)];
  if (kind === undefined) {
    throw new Error(
      `Unknown RENDER kind "${kindToken}". Expected one of: ${Object.keys(
        RENDER_KIND_BY_TOKEN,
      ).join(", ")}.`,
    );
  }

  if (!CHART_RENDER_KINDS.has(kind)) {
    if (withText.length > 0) {
      throw new Error(
        `RENDER ${normalizeToken(kindToken)} does not take a WITH clause.`,
      );
    }
    return ReportRenderSpecSchema.parse({ kind });
  }

  const { encoding, options } = parseRenderWith(
    withText,
    outputColumns,
    groupBys,
  );
  const spec = ReportRenderSpecSchema.parse({ kind, encoding, options });
  if (!("encoding" in spec)) {
    throw new Error(`RENDER ${normalizeToken(kindToken)} is not a chart kind.`);
  }
  validateRenderShape(spec, outputColumns, groupBys);
  return spec;
}

function validateRenderShape(
  render: Extract<ReportRenderSpec, { encoding: ReportRenderChannel }>,
  outputColumns: string[],
  groupBys: ReportGroupBy[],
): void {
  const y = render.encoding.y;
  const yColumns = y === undefined ? [] : Array.isArray(y) ? y : [y];
  if (render.kind === "SCATTER_CHART") {
    if (render.encoding.x === undefined || yColumns.length !== 1) {
      throw new Error("Scatter charts require one x output and one y output.");
    }
    if (!outputColumns.includes(render.encoding.x)) {
      throw new Error(
        "Scatter chart x must reference a numeric SELECT output.",
      );
    }
  }
  if (render.kind === "HEATMAP" && groupBys.length !== 2) {
    throw new Error("Heatmaps require exactly two GROUP BY dimensions.");
  }
  if (
    render.kind === "RADAR_CHART" &&
    (yColumns.length < 3 || yColumns.length > 8)
  ) {
    throw new Error("Radar charts require between three and eight y outputs.");
  }
  if (render.kind === "DONUT_CHART" && yColumns.length > 1) {
    throw new Error("Donut charts accept exactly one y output.");
  }
  if (
    render.kind === "KPI_CARD" &&
    groupBys.some((groupBy) => groupBy !== "all")
  ) {
    throw new Error("KPI cards require GROUP BY all.");
  }
}

function parseRenderWith(
  withText: string,
  outputColumns: string[],
  groupBys: ReportGroupBy[],
): { encoding: ReportRenderChannel; options: ReportChartOptions } {
  const encoding: ReportRenderChannel = {};
  const options: ReportChartOptions = {};
  if (withText.length === 0) return { encoding, options };

  const withMatch = RENDER_WITH_PATTERN.exec(withText);
  if (withMatch?.groups === undefined) {
    throw new Error(
      'Invalid RENDER options. Expected: WITH (x = <col>, y = <col>, title = "…", y_axis = "…").',
    );
  }

  const body = withMatch.groups["body"] ?? "";
  const context = { outputColumns, groupBys };
  for (const pair of splitRenderPairs(body)) {
    const { key, value } = RenderPairSchema.parse(pair);
    const normalizedKey = normalizeToken(key);
    if (setRenderEncoding(normalizedKey, value, encoding, context)) {
      continue;
    }
    setRenderOption(normalizedKey, key, value, options);
  }
  return { encoding, options };
}

function setRenderEncoding(
  key: string,
  value: string,
  encoding: ReportRenderChannel,
  context: { outputColumns: string[]; groupBys: ReportGroupBy[] },
): boolean {
  if (key === "x" || key === "series") {
    encoding[key] = assertRenderColumn(
      normalizeColumnRef(value),
      context.outputColumns,
      context.groupBys,
      "x",
    );
    return true;
  }
  if (key === "y") {
    const columns = parseRenderList(value).map((column) =>
      assertRenderColumn(column, context.outputColumns, context.groupBys, "y"),
    );
    encoding.y = columns.length === 1 ? columns[0] : columns;
    return true;
  }
  if (key === "size" || key === "value") {
    encoding[key] = assertRenderColumn(
      normalizeColumnRef(value),
      context.outputColumns,
      context.groupBys,
      "y",
    );
    return true;
  }
  return false;
}

function setRenderOption(
  normalizedKey: string,
  originalKey: string,
  value: string,
  options: ReportChartOptions,
): void {
  switch (normalizedKey) {
    case "title":
    case "subtitle": {
      options[normalizedKey] = stripRenderQuotes(value);
      return;
    }
    case "x_axis": {
      options.xAxisLabel = stripRenderQuotes(value);
      return;
    }
    case "y_axis": {
      options.yAxisLabel = stripRenderQuotes(value);
      return;
    }
    case "theme": {
      options.theme = ReportChartThemeSchema.parse(normalizeColumnRef(value));
      return;
    }
    case "palette": {
      options.palette = ReportChartPaletteSchema.parse(
        normalizeColumnRef(value),
      );
      return;
    }
    case "colors": {
      options.colors = ReportHexColorSchema.array()
        .min(1)
        .max(8)
        .parse(parseRenderList(value));
      return;
    }
    case "orientation": {
      options.orientation = ReportChartOrientationSchema.parse(
        normalizeColumnRef(value),
      );
      return;
    }
    case "labels": {
      options.labels = ReportChartLabelsSchema.parse(normalizeColumnRef(value));
      return;
    }
    case "legend": {
      options.legend = ReportChartLegendSchema.parse(normalizeColumnRef(value));
      return;
    }
    case "sort": {
      options.sort = ReportChartSortSchema.parse(normalizeColumnRef(value));
      return;
    }
    case "smooth": {
      const normalized = normalizeColumnRef(value);
      if (normalized !== "true" && normalized !== "false") {
        throw new Error("RENDER smooth must be true or false.");
      }
      options.smooth = normalized === "true";
      return;
    }
    default: {
      throw new Error(`Unknown RENDER option "${originalKey}".`);
    }
  }
}

function assertRenderColumn(
  column: string,
  outputColumns: string[],
  groupBys: ReportGroupBy[],
  channel: "x" | "y",
): string {
  const dimensionNames = new Set(
    groupBys.flatMap((groupBy) =>
      groupBy === "group" ? ["label", "group", "pair"] : ["label", groupBy],
    ),
  );
  if (
    (channel === "x" && dimensionNames.has(column)) ||
    outputColumns.includes(column)
  ) {
    return column;
  }
  throw new Error(
    `RENDER ${channel} = "${column}" is not a SELECTed metric or alias. Available: ${outputColumns.join(
      ", ",
    )}.`,
  );
}

function parseRenderList(raw: string): string[] {
  const value = raw.trim();
  if (!value.startsWith("(") || !value.endsWith(")")) {
    return [normalizeColumnRef(value)];
  }
  return splitRenderPairs(value.slice(1, -1)).map((item) =>
    normalizeColumnRef(item.key),
  );
}

function splitRenderPairs(body: string): { key: string; value: string }[] {
  const segments: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === undefined) continue;
    if ((char === "'" || char === '"') && body[index - 1] !== "\\") {
      quote = quote === undefined ? char : quote === char ? undefined : quote;
      continue;
    }
    if (quote !== undefined) continue;
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      segments.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  segments.push(body.slice(start).trim());
  return segments
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const equals = segment.indexOf("=");
      return equals === -1
        ? { key: segment, value: segment }
        : {
            key: segment.slice(0, equals).trim(),
            value: segment.slice(equals + 1).trim(),
          };
    });
}

function normalizeColumnRef(value: string): string {
  return normalizeToken(stripRenderQuotes(value));
}

function stripRenderQuotes(raw: string): string {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).replaceAll(/\\["']/gu, (match) => match.slice(1));
  }
  return value;
}
