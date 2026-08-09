export function resolveHeatmapAxes(
  groupBys: readonly string[],
  encoding: { x?: string | undefined; series?: string | undefined },
): { xDim: number; yDim: number } {
  const xFromX = heatmapDimensionIndex(groupBys, encoding.x);
  const xFromSeries = heatmapDimensionIndex(groupBys, encoding.series);
  const xDim =
    xFromX ?? (xFromSeries === undefined ? 0 : xFromSeries === 0 ? 1 : 0);
  return { xDim, yDim: xDim === 0 ? 1 : 0 };
}

export function resolveCategoricalAxes(
  groupBys: readonly string[],
  encoding: { x?: string | undefined; series?: string | undefined },
): { seriesDim: number; pointDim: number } {
  const pointFromX = dimensionIndex(groupBys, encoding.x);
  const seriesFromEncoding = dimensionIndex(groupBys, encoding.series);
  if (
    pointFromX !== undefined &&
    seriesFromEncoding !== undefined &&
    pointFromX === seriesFromEncoding
  ) {
    throw new Error("Chart x and series must reference different dimensions.");
  }
  const seriesDim =
    seriesFromEncoding ??
    (pointFromX === undefined ? 0 : pointFromX === 0 ? 1 : 0);
  const pointDim =
    pointFromX ??
    (seriesFromEncoding === undefined ? 1 : seriesFromEncoding === 0 ? 1 : 0);
  return { seriesDim, pointDim };
}

export function resolveVisualizationAxes(
  groupBys: readonly string[],
  kind: string,
  encoding: { x?: string | undefined; series?: string | undefined } | undefined,
  temporal: boolean,
): { seriesDim: number; pointDim: number } | undefined {
  if (encoding === undefined || temporal || groupBys.length <= 1) {
    return undefined;
  }
  if (kind === "HEATMAP") {
    const axes = resolveHeatmapAxes(groupBys, encoding);
    return { seriesDim: axes.xDim, pointDim: axes.yDim };
  }
  return resolveCategoricalAxes(groupBys, encoding);
}

function heatmapDimensionIndex(
  groupBys: readonly string[],
  channel: string | undefined,
): number | undefined {
  if (channel === undefined) return undefined;
  const index = groupBys.indexOf(channel);
  return index === -1 ? undefined : index;
}

function dimensionIndex(
  groupBys: readonly string[],
  channel: string | undefined,
): number | undefined {
  if (channel === undefined) return undefined;
  const index = groupBys.indexOf(channel);
  return index === -1 ? undefined : index;
}
