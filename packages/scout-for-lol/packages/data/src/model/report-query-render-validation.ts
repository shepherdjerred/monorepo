import type { ReportGroupBy } from "#src/model/report-query-spec.ts";
import type {
  ReportRenderChannel,
  ReportRenderSpec,
} from "#src/model/report.ts";

export function validateRenderShape(
  render: Extract<ReportRenderSpec, { encoding: ReportRenderChannel }>,
  outputColumns: string[],
  groupBys: ReportGroupBy[],
  logicalGroupBys: ReportGroupBy[],
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
  if (render.kind === "BUMP_CHART") {
    if (groupBys.length < 2) {
      throw new Error(
        "Bump charts require a time bucket and a player dimension.",
      );
    }
    if (yColumns.length !== 1) {
      throw new Error(
        "Bump charts require exactly one y output to rank within each bucket.",
      );
    }
  }
  if (render.kind === "CALENDAR_HEATMAP") {
    validateCalendarHeatmap(
      groupBys,
      logicalGroupBys,
      y === undefined ? 1 : yColumns.length,
    );
  }
  if (render.kind === "RADAR_CHART") {
    validateRadarChart(
      yColumns.length,
      groupBys.length === 1 && logicalGroupBys.length === 1,
    );
  }
  if (render.kind === "DONUT_CHART" && yColumns.length > 1) {
    throw new Error("Donut charts accept exactly one y output.");
  }
  if (
    render.kind === "KPI_CARD" &&
    logicalGroupBys.some((groupBy) => groupBy !== "all")
  ) {
    throw new Error("KPI cards require GROUP BY all.");
  }
}

function validateRadarChart(
  yOutputCount: number,
  hasOneGroupBy: boolean,
): void {
  if (yOutputCount < 3 || yOutputCount > 8) {
    throw new Error("Radar charts require between three and eight y outputs.");
  }
  if (!hasOneGroupBy) {
    throw new Error("Radar charts require exactly one GROUP BY dimension.");
  }
}

function validateCalendarHeatmap(
  groupBys: ReportGroupBy[],
  logicalGroupBys: ReportGroupBy[],
  yOutputCount: number,
): void {
  if (!groupBys.includes("day")) {
    throw new Error("Calendar heatmaps require daily temporal buckets.");
  }
  if (logicalGroupBys.some((groupBy) => groupBy !== "all")) {
    throw new Error("Calendar heatmaps require GROUP BY all.");
  }
  if (yOutputCount !== 1) {
    throw new Error("Calendar heatmaps require exactly one y output.");
  }
}
