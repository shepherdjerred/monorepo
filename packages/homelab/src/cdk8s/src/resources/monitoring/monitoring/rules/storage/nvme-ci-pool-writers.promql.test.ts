import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { expectPromtoolRulesPass } from "./promtool-test.ts";
import {
  CI_POOL_DAILY_WRITE_TARGET_BYTES,
  CI_POOL_WRITER_ALERT_THRESHOLD_BYTES,
  CI_POOL_WRITER_LOGICAL_BYTES_24H,
  CI_POOL_WRITER_TARGET_BYTES,
  getNvmeRuleGroups,
} from "./nvme.ts";

// 361 samples at 5m span 30h; the checks evaluate at the end, so the 24h window
// starts at 6h and the 24h before it covers 0h..6h.
const SAMPLES = 30 * 12 + 1;
const GB = 1e9;

function poolDataset(
  name: string,
  values: string,
  node = "liskov",
  pod = "node-exporter-a",
) {
  return {
    series: `node_zfs_zpool_dataset_nwritten{node="${node}",zpool="zfspv-pool-nvme",dataset="zfspv-pool-nvme/${name}",instance="${node}:9100",pod="${pod}"}`,
    values,
  };
}

function poolClaim(
  claim: string,
  storageclass: string,
  volumename: string,
  values = `1x${String(SAMPLES - 1)}`,
) {
  // `<namespace>/<claim>`
  const [namespace, persistentvolumeclaim] = claim.split("/");
  return {
    series: `kube_persistentvolumeclaim_info{namespace="${String(namespace)}",persistentvolumeclaim="${String(persistentvolumeclaim)}",storageclass="${storageclass}",volumename="${volumename}"}`,
    values,
  };
}

function writerOf(expr: string): string {
  const writer = /writer="(\w+)"/u.exec(expr)?.[1];
  if (writer === undefined) throw new Error(`no writer in ${expr}`);
  return writer;
}

// A counter that grows by `perStep` every sample for the whole test.
function growing(startBytes: number, perStep: number): string {
  return `${String(startBytes)}+${String(perStep)}x${String(SAMPLES - 1)}`;
}

function writerRules() {
  const groups = getNvmeRuleGroups();
  const recording = groups
    .flatMap((group) => group.rules ?? [])
    .find((rule) => rule.record === CI_POOL_WRITER_LOGICAL_BYTES_24H);
  const alerts = groups
    .flatMap((group) => group.rules ?? [])
    .filter(
      (rule) =>
        rule.alert !== undefined &&
        String(rule.expr.value).includes(CI_POOL_WRITER_LOGICAL_BYTES_24H),
    );
  if (recording === undefined) {
    throw new Error("Missing the CI pool writer recording rule");
  }
  return { recording, alerts };
}

async function runPromtool(
  prefix: string,
  rules: unknown[],
  tests: Record<string, unknown>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await Bun.write(
      path.join(directory, "rules.json"),
      JSON.stringify({
        groups: [{ name: "ci-pool-writers", interval: "5m", rules }],
      }),
    );
    const testFile = path.join(directory, "tests.json");
    await Bun.write(
      testFile,
      JSON.stringify({
        rule_files: ["rules.json"],
        evaluation_interval: "5m",
        tests: [{ interval: "5m", ...tests }],
      }),
    );
    await expectPromtoolRulesPass(testFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("CI pool writes are attributed to the writer that owns each dataset", async () => {
  const { recording } = writerRules();
  // A volume that is mounted in short sessions all day: each mount restarts
  // `nwritten` at zero. Four samples (0..3 GB) and a 30-sample gap, repeated.
  // `increase()` adds each session's 3 GB; the largest value ever seen is 3 GB.
  const sessions = Array.from(
    { length: Math.ceil(SAMPLES / 34) },
    () => `0+${String(GB)}x3 _x30`,
  ).join(" ");

  await runPromtool(
    "nvme-ci-pool-writers-",
    [{ record: recording.record, expr: recording.expr.value }],
    {
      input_series: [
        // buildkit: long-lived, 288 GB/day (1 GB every 5 minutes).
        poolDataset("pvc-bk", growing(5000 * GB, GB)),
        poolClaim("buildkitd/buildkitd-cache-liskov", "zfs-ssd-lz4", "pvc-bk"),
        // delivery: remounted all day.
        poolDataset("pvc-dl", sessions),
        poolClaim(
          "delivery-worker-jobs/delivery-stage-workspace-full",
          "zfs-ssd-lz4",
          "pvc-dl",
        ),
        // caches: long-lived, 28.8 GB/day. A second namespace's claim names the
        // same volume (a restore claim); the join must not fail on it.
        poolDataset("pvc-cache", growing(300 * GB, 0.1 * GB)),
        poolClaim(
          "woodpecker-ci/woodpecker-bun-cache",
          "zfs-ssd-lz4",
          "pvc-cache",
        ),
        poolClaim("restore/woodpecker-bun-cache", "zfs-ssd-lz4", "pvc-cache"),
        // workspaces: two volumes created inside the window and gone within the
        // hour. The first wrote 2 GB before its first scrape, so its last value
        // (5 GB) is the whole lifetime, where increase() would say 3 GB.
        poolDataset("pvc-ws1", `_x336 ${String(2 * GB)}+${String(0.5 * GB)}x6`),
        poolClaim(
          "woodpecker-ci/wp-01aaa-0-default",
          "ci-workspace",
          "pvc-ws1",
          "_x336 1x7",
        ),
        poolDataset("pvc-ws2", `_x340 0+${String(GB)}x3`),
        poolClaim(
          "woodpecker-ci/wp-01bbb-0-default",
          "ci-workspace",
          "pvc-ws2",
          "_x340 1x4",
        ),
        // other: a dataset no claim owns, 2.88 GB/day.
        poolDataset("pvc-orphan", growing(10 * GB, 0.01 * GB)),
        // Not the CI pool: ignored.
        poolDataset("pvc-bk", growing(1 * GB, 50 * GB), "torvalds"),
      ],
      promql_expr_test: [
        {
          expr: `round(${CI_POOL_WRITER_LOGICAL_BYTES_24H} / 1e8)`,
          eval_time: "30h",
          exp_samples: [
            { labels: '{writer="buildkit"}', value: 2880 },
            { labels: '{writer="caches"}', value: 288 },
            // Eight mount sessions of 3 GB (24 GB, 24.4 with extrapolation);
            // the largest value ever seen, which max_over_time would report,
            // is 3 GB.
            { labels: '{writer="delivery"}', value: 244 },
            { labels: '{writer="other"}', value: 29 },
            { labels: '{writer="workspaces"}', value: 80 },
          ],
        },
      ],
    },
  );
}, 30_000);

// A node-exporter restart gives every dataset a new `pod` label, so each one is
// two series inside the window. Taking the larger piece with max() lost the
// other (a live backtest 10h after a restart summed to 81% of the pool).
test("a node-exporter restart mid-window does not lose the first half of a dataset's writes", async () => {
  const { recording } = writerRules();
  const restartStep = 216; // 18h in: 12h of the window before it, 12h after
  const before = `${String(5000 * GB)}+${String(GB)}x${String(restartStep - 1)}`;
  const after = `_x${String(restartStep)} ${String(5000 * GB + restartStep * GB)}+${String(GB)}x${String(SAMPLES - 1 - restartStep)}`;

  await runPromtool(
    "nvme-ci-pool-writers-restart-",
    [{ record: recording.record, expr: recording.expr.value }],
    {
      input_series: [
        // buildkit: still 1 GB every 5 minutes, 288 GB over the window, split
        // across two exporter pods at the restart.
        poolDataset("pvc-bk", before, "liskov", "node-exporter-a"),
        poolDataset("pvc-bk", after, "liskov", "node-exporter-b"),
        poolClaim("buildkitd/buildkitd-cache-liskov", "zfs-ssd-lz4", "pvc-bk"),
      ],
      promql_expr_test: [
        {
          expr: `round(${CI_POOL_WRITER_LOGICAL_BYTES_24H} / 1e8)`,
          eval_time: "30h",
          // 143.5 GB before the restart plus 144.5 GB after, with the
          // extrapolation to the window edges; max() would give 144.5 GB.
          exp_samples: [{ labels: '{writer="buildkit"}', value: 2880 }],
        },
      ],
    },
  );
}, 30_000);

test("each CI pool writer alerts when it stays over its regression threshold for 6 hours", async () => {
  const { alerts } = writerRules();
  expect(alerts.map((rule) => rule.alert)).toEqual([
    "CIPoolWorkspaceWritesRegressed",
    "CIPoolBuildkitWritesRegressed",
    "CIPoolDeliveryWritesRegressed",
    "CIPoolCacheWritesRegressed",
  ]);
  for (const rule of alerts) {
    expect(rule.for).toBe("6h");
    expect(rule.labels?.["severity"]).toBe("warning");
  }
  // The targets drive the dashboard; the alerts guard against regressions from
  // today's levels (just above each writer's 14-day p90) and ratchet down to
  // the targets as the CI write program lands.
  expect(CI_POOL_WRITER_TARGET_BYTES).toEqual({
    workspaces: 250 * GB,
    buildkit: 100 * GB,
    delivery: 50 * GB,
    caches: 70 * GB,
  });
  expect(CI_POOL_WRITER_ALERT_THRESHOLD_BYTES).toEqual({
    workspaces: 2600 * GB,
    buildkit: 1000 * GB,
    delivery: 550 * GB,
    caches: 70 * GB,
  });
  expect(CI_POOL_DAILY_WRITE_TARGET_BYTES).toBe(500 * GB);

  // Each writer 1 GB over its threshold, and `other` far over: it has none, so
  // exactly the four writers with thresholds fire.
  const written = {
    workspaces: 2601,
    buildkit: 1001,
    delivery: 551,
    caches: 71,
    other: 900,
  };
  await runPromtool(
    "nvme-ci-pool-writer-alerts-",
    alerts.map((rule) => ({
      alert: rule.alert,
      expr: rule.expr.value,
      for: rule.for,
      labels: rule.labels,
    })),
    {
      input_series: Object.entries(written).map(([writer, gb]) => ({
        series: `${CI_POOL_WRITER_LOGICAL_BYTES_24H}{writer="${writer}"}`,
        values: `${String(gb * GB)}x80`,
      })),
      alert_rule_test: [
        // Over threshold for 5h55m: still pending.
        {
          eval_time: "5h55m",
          alertname: "CIPoolBuildkitWritesRegressed",
          exp_alerts: [],
        },
        ...alerts.map((rule) => ({
          eval_time: "6h5m",
          alertname: rule.alert,
          exp_alerts: [
            {
              exp_labels: {
                severity: "warning",
                category: "ci",
                namespace: "woodpecker-ci",
                writer: writerOf(String(rule.expr.value)),
              },
            },
          ],
        })),
      ],
    },
  );
}, 30_000);
