import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import {
  createSeaweedFsBackupDashboard,
  SEAWEEDFS_STAGE_QUERY,
} from "@shepherdjerred/homelab/cdk8s/grafana/storage/seaweedfs-backup-dashboard.ts";

const serialized = JSON.stringify(createSeaweedFsBackupDashboard());
const rendered = z
  .object({
    panels: z.array(
      z.object({
        title: z.string(),
        targets: z.array(z.object({ expr: z.string() })),
      }),
    ),
  })
  .parse(JSON.parse(serialized));
if (
  rendered.panels.find((panel) => panel.title === "Current Stage")?.targets[0]
    ?.expr !== SEAWEEDFS_STAGE_QUERY
)
  throw new Error("Rendered dashboard did not retain the current-stage query");

const series = (metric: string, labels: string, value: number) => ({
  series: `${metric}{${labels}}`,
  values: `${String(value)}+0x60`,
});
const worker = (pod: string, value = 1) =>
  series(
    "up",
    `namespace="temporal",pod="${pod}",service="temporal-infra-worker-metrics"`,
    value,
  );
const schedule = (input?: {
  running?: number;
  unknown?: number;
  observedAt?: number;
}) => {
  const labels =
    'namespace="temporal",pod="observer",temporal_namespace="prod",schedule_id="seaweedfs-backup-daily",workflow_type="seaweedFsBackup"';
  return [
    series(
      "temporal_schedule_observation_timestamp_seconds",
      labels,
      input?.observedAt ?? 3500,
    ),
    series("temporal_schedule_running", labels, input?.running ?? 1),
    series("temporal_schedule_health_unknown", labels, input?.unknown ?? 0),
  ];
};
const stage = (pod: string, active: string, observedAt: number) => [
  series(
    "seaweedfs_backup_stage",
    `namespace="temporal",pod="${pod}",cadence="daily",stage="${active}"`,
    1,
  ),
  series(
    "seaweedfs_backup_stage_observation_timestamp_seconds",
    `namespace="temporal",pod="${pod}",cadence="daily"`,
    observedAt,
  ),
];
const active = [
  {
    labels:
      'seaweedfs_backup_stage{namespace="temporal",pod="new",cadence="daily",stage="verify"}',
    value: 1,
  },
];
const cases = [
  {
    name: "newest live owner wins while both workers are live",
    input: [
      ...schedule(),
      worker("old"),
      worker("new"),
      ...stage("old", "copy", 3400),
      ...stage("new", "verify", 3500),
    ],
    expected: active,
  },
  {
    name: "latest dead owner remains unknown instead of showing an older live stage",
    input: [
      ...schedule(),
      worker("old"),
      worker("new", 0),
      ...stage("old", "copy", 3400),
      ...stage("new", "verify", 3500),
    ],
    expected: [],
  },
  {
    name: "old stage observations remain unknown despite a live worker",
    input: [...schedule(), worker("new"), ...stage("new", "verify", 1700)],
    expected: [],
  },
  {
    name: "missing stage observation does not borrow another worker's health",
    input: [
      ...schedule(),
      worker("new"),
      series(
        "seaweedfs_backup_stage",
        'namespace="temporal",pod="old",cadence="daily",stage="copy"',
        1,
      ),
    ],
    expected: [],
  },
  {
    name: "known recent idle schedule does not display a cached active stage",
    input: [
      ...schedule({ running: 0 }),
      worker("new"),
      ...stage("new", "verify", 3500),
    ],
    expected: [
      {
        labels:
          '{cadence="daily",schedule_id="seaweedfs-backup-daily",stage="Idle"}',
        value: 1,
      },
    ],
  },
  {
    name: "unknown schedule does not synthesize idle or active",
    input: [
      ...schedule({ unknown: 1 }),
      worker("new"),
      ...stage("new", "verify", 3500),
    ],
    expected: [],
  },
  {
    name: "stale schedule observation remains unknown",
    input: [
      ...schedule({ observedAt: 1700 }),
      worker("new"),
      ...stage("new", "verify", 3500),
    ],
    expected: [],
  },
  {
    name: "no live infra worker remains unknown even when schedule is idle",
    input: [...schedule({ running: 0 }), worker("new", 0)],
    expected: [],
  },
];

const directory = await mkdtemp(
  path.join(tmpdir(), "homelab-backup-dashboard-"),
);
const filename = path.join(directory, "tests.yaml");
try {
  await Bun.write(
    filename,
    YAML.stringify({
      evaluation_interval: "1m",
      tests: cases.map((entry) => ({
        name: entry.name,
        interval: "1m",
        input_series: entry.input,
        promql_expr_test: [
          {
            expr: SEAWEEDFS_STAGE_QUERY,
            eval_time: "1h",
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
    throw new Error("SeaweedFS backup dashboard regression failed");
} finally {
  await rm(filename);
  await rmdir(directory);
}
