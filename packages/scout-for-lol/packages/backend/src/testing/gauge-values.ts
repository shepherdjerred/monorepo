import type { Gauge } from "prom-client";

/**
 * Read one series off a gauge, or undefined when nothing wrote it.
 *
 * Shared because the distinction between a series holding 0 and a series that
 * does not exist is load-bearing for the durable metrics: the sweeps zero-fill
 * precisely so that a drained backlog and a dead sweep stop looking alike, and
 * the alerts guard on `absent()`. A test asserting that needs to be able to say
 * "no series", which `toBe(0)` cannot.
 */
export async function gaugeValue(
  metric: Gauge,
  labels: Record<string, string>,
): Promise<number | undefined> {
  const emitted = await metric.get();
  return emitted.values.find((series) =>
    Object.entries(labels).every(
      ([key, expected]) => series.labels[key] === expected,
    ),
  )?.value;
}
