import os from "node:os";

const ENDPOINT = "https://otlp-metrics.tailnet-1a49.ts.net/v1/metrics";

export type MetricSample = {
  name: string;
  value: number;
  labels?: Readonly<Record<string, string>>;
  cumulative?: true;
};

export type ExportMetrics = (
  samples: readonly MetricSample[],
  startedAt: number,
  now: number,
) => Promise<void>;

function attributes(labels: Readonly<Record<string, string>>) {
  return Object.entries(labels).map(([key, stringValue]) => ({
    key,
    value: { stringValue },
  }));
}

function nanoseconds(milliseconds: number): string {
  return String(BigInt(milliseconds) * 1_000_000n);
}

export const exportMetrics: ExportMetrics = async (samples, startedAt, now) => {
  const metrics = Map.groupBy(samples, ({ name }) => name);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      resourceMetrics: [
        {
          resource: {
            attributes: attributes({
              "service.name": "justin-principal-engineer",
              "service.instance.id": os.hostname(),
            }),
          },
          scopeMetrics: [
            {
              scope: { name: "justin-principal-engineer" },
              metrics: Array.from(metrics, ([name, series]) => {
                const cumulative = series[0]?.cumulative === true;
                const dataPoints = series.map(({ value, labels }) => ({
                  asDouble: value,
                  attributes: attributes(labels ?? {}),
                  timeUnixNano: nanoseconds(now),
                  ...(cumulative
                    ? { startTimeUnixNano: nanoseconds(startedAt) }
                    : {}),
                }));
                return {
                  name,
                  ...(cumulative
                    ? {
                        sum: {
                          aggregationTemporality: 2,
                          isMonotonic: true,
                          dataPoints,
                        },
                      }
                    : { gauge: { dataPoints } }),
                };
              }),
            },
          ],
        },
      ],
    }),
  });
  try {
    if (!response.ok) throw new Error("Justin metrics export was rejected");
  } finally {
    await response.body?.cancel();
  }
};
