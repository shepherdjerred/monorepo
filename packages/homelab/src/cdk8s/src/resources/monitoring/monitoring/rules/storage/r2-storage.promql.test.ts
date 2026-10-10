import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { getR2StorageRuleGroups } from "./r2-storage.ts";

const sample = (value: number, labels = "{}") => [{ labels, value }];
const bucketLabels = '{bucket="homelab"}';

test("R2 audit alerts evaluate persisted age and the newest owner's inventory", async () => {
  const rules = getR2StorageRuleGroups().find(
    (group) => group.name === "velero-r2-orphans",
  )?.rules;
  if (rules === undefined) throw new Error("Missing R2 audit rules");
  const expressions = Object.fromEntries(
    rules.map((rule) => [rule.alert, rule.expr.value]),
  );
  const owner =
    'namespace="temporal",container="temporal-infra-worker",bucket="homelab"';
  const inventory = (
    pod: string,
    timestamp: number,
    prefixes: number,
    bytes: number,
  ) => [
    {
      series: `velero_r2_audit_observation_timestamp_seconds{${owner},pod="${pod}"}`,
      values: `${String(timestamp)}+0x48`,
    },
    {
      series: `velero_orphan_r2_prefixes_total{${owner},pod="${pod}"}`,
      values: `${String(prefixes)}+0x48`,
    },
    {
      series: `velero_orphan_r2_bytes_total{${owner},pod="${pod}"}`,
      values: `${String(bytes)}+0x48`,
    },
  ];
  const bytes = 1024 ** 4;
  const cases = [
    {
      name: "fresh restored orphan inventory",
      at: "24h",
      input: inventory("new", 0, 78, bytes),
      prefixes: sample(78, bucketLabels),
      bytes: sample(bytes, bucketLabels),
      stale: [],
    },
    {
      name: "restoration does not renew an expired observation",
      at: "37h",
      input: inventory("new", 0, 78, bytes),
      prefixes: sample(78, bucketLabels),
      bytes: sample(bytes, bucketLabels),
      stale: sample(37 * 3600, bucketLabels),
    },
    {
      name: "missing observation remains unknown",
      at: "24h",
      input: [],
      prefixes: [],
      bytes: [],
      stale: sample(1, bucketLabels),
    },
    {
      name: "verified zero remains healthy",
      at: "24h",
      input: inventory("new", 0, 0, 0),
      prefixes: [],
      bytes: [],
      stale: [],
    },
    {
      name: "newer zero supersedes old nonzero pod during rollout",
      at: "24h",
      input: [
        ...inventory("old", 0, 78, bytes),
        ...inventory("new", 3600, 0, 0),
      ],
      prefixes: [],
      bytes: [],
      stale: [],
    },
    {
      name: "unowned zeros cannot mask the owning worker",
      at: "24h",
      input: [
        ...inventory("infra", 0, 78, bytes),
        {
          series:
            'velero_orphan_r2_prefixes_total{namespace="temporal",container="temporal-reports-worker"}',
          values: "0+0x48",
        },
      ],
      prefixes: sample(78, bucketLabels),
      bytes: sample(bytes, bucketLabels),
      stale: [],
    },
  ];
  const directory = await mkdtemp(path.join(tmpdir(), "r2-audit-promql-"));
  try {
    const filename = path.join(directory, "tests.json");
    await Bun.write(
      filename,
      JSON.stringify({
        evaluation_interval: "1h",
        tests: cases.map((entry) => ({
          name: entry.name,
          interval: "1h",
          input_series: entry.input,
          promql_expr_test: [
            {
              expr: expressions.VeleroR2OrphanPrefixes,
              eval_time: entry.at,
              exp_samples: entry.prefixes,
            },
            {
              expr: expressions.VeleroR2OrphanBytesExcessive,
              eval_time: entry.at,
              exp_samples: entry.bytes,
            },
            {
              expr: expressions.VeleroR2OrphanAuditNotRunning,
              eval_time: entry.at,
              exp_samples: entry.stale,
            },
          ],
        })),
      }),
    );
    const process = Bun.spawn(["promtool", "test", "rules", filename], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode, stdout + stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
