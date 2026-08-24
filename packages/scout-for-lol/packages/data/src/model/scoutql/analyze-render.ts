import { match } from "ts-pattern";
import type {
  ScoutQlRenderClauseAst,
  ScoutQlRenderOptionAst,
} from "#src/model/scoutql/ast.ts";
import type { ScoutQlDiagnostic } from "#src/model/scoutql/diagnostics.ts";
import type {
  ReportChartOptions,
  ReportDisplayKind,
  ReportOutputFormat,
  ReportRenderChannel,
  ReportRenderSpec,
} from "#src/model/report.ts";
import { z } from "zod";
import {
  ReportChartLabelsSchema,
  ReportChartLegendSchema,
  ReportChartOrientationSchema,
  ReportChartPaletteSchema,
  ReportChartSortSchema,
  ReportChartStackSchema,
  ReportChartThemeSchema,
  ReportDisplayKindSchema,
  ReportOutputFormatSchema,
  ReportRenderSpecSchema,
} from "#src/model/report.ts";
import type { ScoutQlTimeWindow } from "#src/model/scoutql/plan.ts";
import { closestScoutQlName } from "#src/model/scoutql/catalog-functions.ts";
import { emitDiagnostic } from "#src/model/scoutql/analyze-expr-shared.ts";
import type { AnalyzedGrouping } from "#src/model/scoutql/analyze-group.ts";
import type { AnalyzedOutput } from "#src/model/scoutql/analyze-select.ts";
import {
  readBoolean,
  readEnum,
  readHexColors,
  readInteger,
  readMentions,
  readNameList,
  readPairs,
  readSingleName,
  readString,
  type OptionReader,
} from "#src/model/scoutql/analyze-render-options.ts";
import { checkRenderShape } from "#src/model/scoutql/analyze-render-shape.ts";

// ── RENDER analysis ──────────────────────────────────────────────────────────
// The surface kind name maps through a closed table to ReportOutputFormat, and
// each option is typed against the render schemas with its diagnostic spanned
// to the offending value. Shape and compatibility rules live in
// analyze-render-shape.ts.

const RENDER_KINDS: ReadonlyMap<string, ReportOutputFormat> = new Map(
  ReportOutputFormatSchema.options.map((format) => [
    format.toLowerCase(),
    format,
  ]),
);

const CHART_KINDS: ReadonlySet<ReportOutputFormat> = new Set(
  ReportOutputFormatSchema.options.filter(
    (format) =>
      format !== "LIST" && format !== "TABLE" && format !== "LEADERBOARD",
  ),
);

const ComparePeriodSchema = z.literal("previous_period");

const CHANNEL_OPTIONS: ReadonlySet<string> = new Set([
  "x",
  "y",
  "series",
  "size",
  "value",
]);

/** Chart kinds get channel encodings and chart options; text kinds do not. */
export function isChartRenderKind(kind: ReportOutputFormat): boolean {
  return CHART_KINDS.has(kind);
}

export type RenderAnalysisInput = {
  clause: ScoutQlRenderClauseAst;
  outputs: AnalyzedOutput[];
  groupings: AnalyzedGrouping[];
  timeWindow: ScoutQlTimeWindow;
  /** See `WhereAnalysis.residualTouchesTime`. */
  residualTouchesTime: boolean;
  diagnostics: ScoutQlDiagnostic[];
};

type ChannelState = {
  x?: string;
  y?: string | string[];
  series?: string;
  size?: string;
  value?: string;
};

function unknownOption(
  option: ScoutQlRenderOptionAst,
  known: readonly string[],
  diagnostics: ScoutQlDiagnostic[],
  kind: ReportOutputFormat,
): void {
  const suggestion = closestScoutQlName(option.name, known);
  emitDiagnostic(diagnostics, {
    code: "unknown-render-option",
    message: `RENDER ${kind.toLowerCase()} has no option "${option.name}".${suggestion === undefined ? ` Available: ${[...known].join(", ")}.` : ` Did you mean "${suggestion}"?`}`,
    span: option.nameSpan,
  });
}

// ── Channels ─────────────────────────────────────────────────────────────────

function checkChannelNames(
  option: ScoutQlRenderOptionAst,
  names: string[],
  input: RenderAnalysisInput,
): boolean {
  const known = [
    ...input.outputs.map((output) => output.name),
    ...input.groupings.map((grouping) => grouping.grouping.name),
  ];
  let ok = true;
  for (const name of names) {
    if (known.includes(name)) {
      continue;
    }
    ok = false;
    const suggestion = closestScoutQlName(name, known);
    emitDiagnostic(input.diagnostics, {
      code: "render-channel-unknown",
      message: `RENDER ${option.name} = ${name} does not name an output or a grouping.${suggestion === undefined ? ` Available: ${known.join(", ")}.` : ` Did you mean "${suggestion}"?`}`,
      span: option.value.span,
    });
  }
  return ok;
}

function applyChannel(
  option: ScoutQlRenderOptionAst,
  channels: ChannelState,
  input: RenderAnalysisInput,
): void {
  const reader: OptionReader = { option, diagnostics: input.diagnostics };
  if (option.name === "y") {
    const names = readNameList(reader);
    if (names === undefined || !checkChannelNames(option, names, input)) {
      return;
    }
    const [only] = names;
    channels.y = only !== undefined && names.length === 1 ? only : names;
    return;
  }
  const name = readSingleName(reader);
  if (name === undefined || !checkChannelNames(option, [name], input)) {
    return;
  }
  match(option.name)
    .with("x", () => {
      channels.x = name;
    })
    .with("series", () => {
      channels.series = name;
    })
    .with("size", () => {
      channels.size = name;
    })
    .with("value", () => {
      channels.value = name;
    })
    .otherwise(() => {
      // Unreachable: the caller only routes CHANNEL_OPTIONS here.
    });
}

// ── Chart options ────────────────────────────────────────────────────────────

function applyFormatOption(
  option: ScoutQlRenderOptionAst,
  options: ReportChartOptions,
  input: RenderAnalysisInput,
): void {
  const reader: OptionReader = { option, diagnostics: input.diagnostics };
  const pairs = readPairs(reader);
  if (pairs === undefined) {
    return;
  }
  const formats: Record<string, ReportDisplayKind> = {};
  for (const pair of pairs) {
    if (!input.outputs.some((output) => output.name === pair.name)) {
      emitDiagnostic(input.diagnostics, {
        code: "render-option-invalid",
        message: `format keys name SELECT outputs; "${pair.name}" is not one.`,
        span: pair.span,
      });
      continue;
    }
    const kind = ReportDisplayKindSchema.safeParse(pair.value);
    if (!kind.success) {
      emitDiagnostic(input.diagnostics, {
        code: "render-option-invalid",
        message: `"${pair.value}" is not a display kind. Available: ${ReportDisplayKindSchema.options.join(", ")}.`,
        span: pair.span,
      });
      continue;
    }
    formats[pair.name] = kind.data;
  }
  if (Object.keys(formats).length > 0) {
    options.format = formats;
  }
}

const CHART_OPTION_NAMES = [
  "title",
  "subtitle",
  "x_axis",
  "y_axis",
  "theme",
  "palette",
  "colors",
  "orientation",
  "labels",
  "legend",
  "sort",
  "smooth",
  "rolling",
  "cumulative",
  "stack",
  "trend",
  "annotations",
  "sparkline",
  "compare",
  "format",
  ...CHANNEL_OPTIONS,
] as const;

function applyChartOption(
  option: ScoutQlRenderOptionAst,
  options: ReportChartOptions,
  input: RenderAnalysisInput,
): void {
  const reader: OptionReader = { option, diagnostics: input.diagnostics };
  const assignString = (apply: (value: string) => void): void => {
    const value = readString(reader);
    if (value !== undefined) {
      apply(value);
    }
  };
  const assignBoolean = (apply: (value: boolean) => void): void => {
    const value = readBoolean(reader);
    if (value !== undefined) {
      apply(value);
    }
  };
  match(option.name)
    .with("title", () => {
      assignString((value) => {
        options.title = value;
      });
    })
    .with("subtitle", () => {
      assignString((value) => {
        options.subtitle = value;
      });
    })
    .with("x_axis", () => {
      assignString((value) => {
        options.xAxisLabel = value;
      });
    })
    .with("y_axis", () => {
      assignString((value) => {
        options.yAxisLabel = value;
      });
    })
    .with("theme", () => {
      options.theme =
        readEnum(
          reader,
          ReportChartThemeSchema,
          ReportChartThemeSchema.options,
        ) ?? options.theme;
    })
    .with("palette", () => {
      options.palette =
        readEnum(
          reader,
          ReportChartPaletteSchema,
          ReportChartPaletteSchema.options,
        ) ?? options.palette;
    })
    .with("orientation", () => {
      options.orientation =
        readEnum(
          reader,
          ReportChartOrientationSchema,
          ReportChartOrientationSchema.options,
        ) ?? options.orientation;
    })
    .with("labels", () => {
      options.labels =
        readEnum(
          reader,
          ReportChartLabelsSchema,
          ReportChartLabelsSchema.options,
        ) ?? options.labels;
    })
    .with("legend", () => {
      options.legend =
        readEnum(
          reader,
          ReportChartLegendSchema,
          ReportChartLegendSchema.options,
        ) ?? options.legend;
    })
    .with("sort", () => {
      options.sort =
        readEnum(
          reader,
          ReportChartSortSchema,
          ReportChartSortSchema.options,
        ) ?? options.sort;
    })
    .with("stack", () => {
      options.stack =
        readEnum(
          reader,
          ReportChartStackSchema,
          ReportChartStackSchema.options,
        ) ?? options.stack;
    })
    .with("colors", () => {
      options.colors = readHexColors(reader) ?? options.colors;
    })
    .with("rolling", () => {
      const window = readInteger(reader, { min: 2, max: 52 });
      if (window !== undefined) {
        options.rolling = { window };
      }
    })
    .with("smooth", () => {
      assignBoolean((value) => {
        options.smooth = value;
      });
    })
    .with("cumulative", () => {
      assignBoolean((value) => {
        options.cumulative = value;
      });
    })
    .with("trend", () => {
      assignBoolean((value) => {
        options.trend = value;
      });
    })
    .with("annotations", () => {
      assignBoolean((value) => {
        options.annotations = value;
      });
    })
    .with("sparkline", () => {
      assignBoolean((value) => {
        options.sparkline = value;
      });
    })
    .with("compare", () => {
      // v2 supports exactly one comparison.
      const value = readEnum(reader, ComparePeriodSchema, ["previous_period"]);
      if (value !== undefined) {
        options.compare = value;
      }
    })
    .with("format", () => {
      applyFormatOption(option, options, input);
    })
    .otherwise(() => {
      // Unreachable: unknown names are reported before routing here.
    });
}

// ── Per-kind assembly ────────────────────────────────────────────────────────

function chartSpecParts(
  input: RenderAnalysisInput,
  kind: ReportOutputFormat,
): { encoding: ReportRenderChannel; options: ReportChartOptions } {
  const channels: ChannelState = {};
  const options: ReportChartOptions = {};
  for (const option of input.clause.options) {
    if (CHANNEL_OPTIONS.has(option.name)) {
      applyChannel(option, channels, input);
      continue;
    }
    if (!CHART_OPTION_NAMES.includes(option.name)) {
      unknownOption(option, CHART_OPTION_NAMES, input.diagnostics, kind);
      continue;
    }
    applyChartOption(option, options, input);
  }
  return { encoding: channels, options };
}

function textualSpec(
  input: RenderAnalysisInput,
  kind: ReportOutputFormat,
): ReportRenderSpec | undefined {
  return match(kind)
    .with("LIST", (): ReportRenderSpec | undefined => {
      for (const option of input.clause.options) {
        unknownOption(option, [], input.diagnostics, kind);
      }
      return { kind: "LIST" };
    })
    .with("TABLE", (): ReportRenderSpec | undefined => {
      let sparkline: boolean | undefined;
      for (const option of input.clause.options) {
        if (option.name !== "sparkline") {
          unknownOption(option, ["sparkline"], input.diagnostics, kind);
          continue;
        }
        sparkline = readBoolean({ option, diagnostics: input.diagnostics });
      }
      return sparkline === undefined
        ? { kind: "TABLE" }
        : { kind: "TABLE", options: { sparkline } };
    })
    .with("LEADERBOARD", (): ReportRenderSpec | undefined => {
      let mentions: number | "all" | undefined;
      for (const option of input.clause.options) {
        if (option.name !== "mentions") {
          unknownOption(option, ["mentions"], input.diagnostics, kind);
          continue;
        }
        mentions = readMentions({ option, diagnostics: input.diagnostics });
      }
      return mentions === undefined
        ? { kind: "LEADERBOARD", options: {} }
        : { kind: "LEADERBOARD", options: { mentions } };
    })
    .otherwise((): ReportRenderSpec | undefined => undefined);
}

export function analyzeRender(
  input: RenderAnalysisInput,
): ReportRenderSpec | undefined {
  const kind = RENDER_KINDS.get(input.clause.kind);
  if (kind === undefined) {
    const suggestion = closestScoutQlName(
      input.clause.kind,
      RENDER_KINDS.keys(),
    );
    emitDiagnostic(input.diagnostics, {
      code: "unknown-render-kind",
      message: `"${input.clause.kind}" is not a render kind.${suggestion === undefined ? ` Available: ${[...RENDER_KINDS.keys()].join(", ")}.` : ` Did you mean "${suggestion}"?`}`,
      span: input.clause.span,
    });
    return undefined;
  }
  const textual = textualSpec(input, kind);
  if (textual !== undefined) {
    return validateSpec(textual, input);
  }
  if (!CHART_KINDS.has(kind)) {
    return undefined;
  }
  const { encoding, options } = chartSpecParts(input, kind);
  checkRenderShape({
    kind,
    encoding,
    options,
    outputs: input.outputs,
    groupings: input.groupings,
    timeWindow: input.timeWindow,
    residualTouchesTime: input.residualTouchesTime,
    span: input.clause.span,
    diagnostics: input.diagnostics,
  });
  return validateSpec({ kind, encoding, options }, input);
}

/**
 * Final schema pass. Everything reaching it has already been checked field by
 * field, so a failure here means a cross-field rule in the render schema (for
 * example rolling with cumulative) that no per-option message covers.
 */
function validateSpec(
  candidate: unknown,
  input: RenderAnalysisInput,
): ReportRenderSpec | undefined {
  const parsed = ReportRenderSpecSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  for (const issue of parsed.error.issues) {
    emitDiagnostic(input.diagnostics, {
      code: "render-option-invalid",
      message: issue.message,
      span: input.clause.span,
    });
  }
  return undefined;
}
