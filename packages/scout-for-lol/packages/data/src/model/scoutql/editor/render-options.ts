/**
 * Every option name a chart render accepts.
 *
 * `analyze-render.ts` is the authority on what each one MEANS; this array is
 * the authority on which names EXIST, so completions can offer them without
 * keeping a second copy that silently drifts — the failure this language
 * overhaul exists to end. A name here with no handler in the analyzer is
 * refused as unknown, which the completion-coverage test catches.
 */
export const SCOUTQL_CHART_OPTION_NAMES: readonly string[] = [
  "x",
  "y",
  "series",
  "size",
  "value",
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
];
