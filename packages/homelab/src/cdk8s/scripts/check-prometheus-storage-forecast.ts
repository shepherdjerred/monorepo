import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { prometheusForecastExpression } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/platform/prometheus-storage-forecast.ts";

// Use the real generated PromQL, not a second arithmetic implementation.
// 31 days of hourly samples exercise normalized history across exporter labels.
const namespace = 'namespace="prometheus"';
const pvc = 'persistentvolumeclaim="data"';
const raw = [
  {
    series: `kube_pod_spec_volumes_persistentvolumeclaims_info{${namespace},pod="prom",${pvc}}`,
    values: "1+0x744",
  },
  {
    series: `prometheus_tsdb_storage_blocks_bytes{${namespace},pod="prom",instance="prom:9090"}`,
    values: "180000000000+10000000x744",
  },
  {
    series: `kubelet_volume_stats_used_bytes{${namespace},${pvc},instance="node:10250"}`,
    values: "184000000000+10000000x744",
  },
  {
    series: `kubelet_volume_stats_capacity_bytes{${namespace},${pvc},instance="node:10250"}`,
    values: "256000000000+0x744",
  },
];
const cap = (value: number) => ({
  series: `prometheus_tsdb_retention_limit_bytes{${namespace},pod="prom",instance="prom:9090"}`,
  values: `${String(value)}+0x744`,
});
const sample = (value: number) => [{ labels: `{${namespace},${pvc}}`, value }];
const cases = [
  {
    name: "block cap and 20 percent reserve both participate",
    input: [...raw, cap(200_000_000_000)],
    expected: sample(251_200_000_000),
  },
  {
    name: "zero cap preserves generic forecast",
    input: [...raw, cap(0)],
    expected: [],
  },
  { name: "missing cap preserves generic forecast", input: raw, expected: [] },
  {
    name: "cap above 80 percent preserves generic forecast",
    input: [...raw, cap(250_000_000_000)],
    expected: [],
  },
  {
    name: "ambiguous pod claims preserve generic forecast",
    input: [
      ...raw,
      cap(200_000_000_000),
      {
        series: `kube_pod_spec_volumes_persistentvolumeclaims_info{${namespace},pod="prom",persistentvolumeclaim="other"}`,
        values: "1+0x744",
      },
    ],
    expected: [],
  },
  {
    name: "incomplete history preserves generic forecast",
    input: [
      ...raw.map((series) => ({ ...series, values: `_x48 ${series.values}` })),
      cap(200_000_000_000),
    ],
    expected: [],
  },
  {
    name: "non-block growth can exceed quota despite block retention",
    input: [
      ...raw.map((series) =>
        series.series.startsWith("kubelet_volume_stats_used_bytes")
          ? { ...series, values: "80000000000+210000000x744" }
          : series,
      ),
      cap(200_000_000_000),
    ],
    expected: sample(536_800_000_000),
  },
];

const directory = await mkdtemp(path.join(tmpdir(), "homelab-forecast-"));
const filename = path.join(directory, "tests.yaml");
try {
  await Bun.write(
    filename,
    YAML.stringify({
      evaluation_interval: "1h",
      tests: cases.map((entry) => ({
        name: entry.name,
        interval: "1h",
        input_series: entry.input,
        promql_expr_test: [
          {
            expr: prometheusForecastExpression(60),
            eval_time: "31d",
            exp_samples: entry.expected,
          },
        ],
      })),
    }),
  );
  const child = Bun.spawn(["promtool", "test", "rules", filename], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error("Prometheus storage forecast regression failed");
} finally {
  await rm(filename);
  await rmdir(directory);
}
