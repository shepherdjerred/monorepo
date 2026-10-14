type GaugeWriter = { set: (value: number) => void };
type Aggregation = "sum" | "min" | "max-absolute";
const contributions = new WeakMap<
  GaugeWriter,
  { aggregation: Aggregation; values: Map<symbol, number> }
>();

/** Own one stream's contribution without erasing other live streams. */
export function contributeGauge(gauge: GaugeWriter, aggregation: Aggregation) {
  let state = contributions.get(gauge);
  if (state === undefined) {
    state = { aggregation, values: new Map() };
    contributions.set(gauge, state);
  }
  if (state.aggregation !== aggregation)
    throw new Error("Gauge aggregation must agree across producers");
  const values = state.values;
  const owner = Symbol();
  let closed = false;
  const publish = () => {
    const samples = [...values.values()];
    let value = 0;
    if (samples.length > 0) {
      switch (aggregation) {
        case "sum":
          value = samples.reduce((total, sample) => total + sample, 0);
          break;
        case "min":
          value = Math.min(...samples);
          break;
        case "max-absolute":
          value = samples.reduce((worst, sample) =>
            Math.abs(sample) > Math.abs(worst) ? sample : worst,
          );
          break;
      }
    }
    gauge.set(value);
  };
  return {
    set(value: number) {
      // Encoder callbacks can arrive after their session has closed.
      if (closed) return;
      if (!Number.isFinite(value))
        throw new TypeError("Nonfinite metric sample");
      values.set(owner, value);
      publish();
    },
    close() {
      if (closed) return;
      closed = true;
      values.delete(owner);
      publish();
    },
  };
}
