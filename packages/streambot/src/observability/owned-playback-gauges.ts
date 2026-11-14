import type { Gauge } from "prom-client";

type Aggregation = "min" | "max" | "sum";
type Series = {
  labels: Record<string, string>;
  aggregation: Aggregation;
  owners: Map<symbol, number>;
};
const gauges = new Map<Gauge, Map<string, Series>>();

/** One pipeline may only remove its own readings; concurrent streams retain theirs. */
export class OwnedPlaybackGauges {
  private readonly owner = Symbol("playback-gauges");
  private disposed = false;

  set(
    gauge: Gauge,
    labels: Record<string, string>,
    value: number,
    aggregation: Aggregation,
  ): void {
    if (this.disposed) return;
    let seriesByKey = gauges.get(gauge);
    if (seriesByKey === undefined) {
      seriesByKey = new Map();
      gauges.set(gauge, seriesByKey);
    }
    const key = JSON.stringify(labels);
    let series = seriesByKey.get(key);
    if (series === undefined) {
      series = { labels, aggregation, owners: new Map() };
      seriesByKey.set(key, series);
    }
    series.owners.set(this.owner, value);
    publish(gauge, series);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [gauge, seriesByKey] of gauges) {
      for (const [key, series] of seriesByKey) {
        if (releaseOwner(gauge, series, this.owner)) seriesByKey.delete(key);
      }
      if (seriesByKey.size === 0) gauges.delete(gauge);
    }
  }
}

function releaseOwner(gauge: Gauge, series: Series, owner: symbol): boolean {
  if (!series.owners.delete(owner)) return false;
  if (series.owners.size > 0) {
    publish(gauge, series);
    return false;
  }
  if (Object.keys(series.labels).length === 0) gauge.reset();
  else gauge.remove(series.labels);
  return true;
}

function publish(gauge: Gauge, series: Series): void {
  const values = [...series.owners.values()];
  const value =
    series.aggregation === "sum"
      ? values.reduce((sum, sample) => sum + sample, 0)
      : series.aggregation === "min"
        ? Math.min(...values)
        : Math.max(...values);
  gauge.set(series.labels, value);
}
