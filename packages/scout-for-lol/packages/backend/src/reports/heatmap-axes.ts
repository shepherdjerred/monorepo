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

function heatmapDimensionIndex(
  groupBys: readonly string[],
  channel: string | undefined,
): number | undefined {
  if (channel === undefined) return undefined;
  const index = groupBys.indexOf(channel);
  return index === -1 ? undefined : index;
}
