import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { expectPromtoolRulesPass } from "./promtool-test.ts";
import {
  CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H,
  getNvmeRuleGroups,
  NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY,
  ZFS_POOL_WRITE_AMPLIFICATION_24H,
} from "./nvme.ts";

const DATA_UNIT_BYTES = 512_000;
const STEPS_PER_DAY = 288; // 5-minute samples
const EVAL_HOURS = 30;

type Drive = {
  node: string;
  device: string;
  serial: string;
  capacityBytes: number;
  used: number;
  lifetimeBytes: number;
  bytesPerDay: number;
};

const drives: Drive[] = [
  // The torvalds pool drive: worn faster than rated (ashift=9), so its
  // observed wear sets the budget, and 1 TB/day exceeds it.
  {
    node: "torvalds",
    device: "nvme1n1",
    serial: "S7KGNU0X511734N",
    capacityBytes: 4e12,
    used: 0.24,
    lifetimeBytes: 300e12,
    bytesPerDay: 1e12,
  },
  // The liskov pool drive: wears slower than rated, so the rated floor sets
  // its budget. 400 GB/day stays inside it.
  {
    node: "liskov",
    device: "nvme1n1",
    serial: "S7L9NJ0L312632A",
    capacityBytes: 2e12,
    used: 0.07,
    lifetimeBytes: 129e12,
    bytesPerDay: 400e9,
  },
  // A brand-new OS disk (percentage_used == 0) that a workload suddenly
  // writes 1 TB/day to: no division by zero, and it still alerts.
  {
    node: "liskov",
    device: "nvme0n1",
    serial: "OSDISKHEAVY",
    capacityBytes: 1e12,
    used: 0,
    lifetimeBytes: 1e9,
    bytesPerDay: 1e12,
  },
];

function driveLabels(drive: Drive): string {
  return `node="${drive.node}",instance="${drive.node}:9100",device="${drive.device}"`;
}

function driveSeries(drive: Drive) {
  const steps = EVAL_HOURS * 12 + 12;
  const unitsPerStep = Math.round(
    drive.bytesPerDay / STEPS_PER_DAY / DATA_UNIT_BYTES,
  );
  const startUnits = Math.round(drive.lifetimeBytes / DATA_UNIT_BYTES);
  return [
    {
      series: `nvme_device_info{${driveLabels(drive)},serial="${drive.serial}",model="Samsung SSD 990 PRO"}`,
      values: `1x${String(steps)}`,
    },
    {
      series: `nvme_data_units_written_total{${driveLabels(drive)}}`,
      values: `${String(startUnits)}+${String(unitsPerStep)}x${String(steps)}`,
    },
    {
      series: `nvme_percentage_used_ratio{${driveLabels(drive)}}`,
      values: `${String(drive.used)}x${String(steps)}`,
    },
    {
      series: `nvme_physical_size_bytes{${driveLabels(drive)}}`,
      values: `${String(drive.capacityBytes)}x${String(steps)}`,
    },
  ];
}

function claim(name: string, values: string) {
  return {
    series: `kube_persistentvolumeclaim_info{namespace="woodpecker-ci",persistentvolumeclaim="${name}",storageclass="ci-workspace"}`,
    values,
  };
}

// Expected 5-year budget in GB/day, from the same definition the rules use.
function expectedBudgetGb(drive: Drive): number {
  const unitsPerStep = Math.round(
    drive.bytesPerDay / STEPS_PER_DAY / DATA_UNIT_BYTES,
  );
  const writtenUnits =
    Math.round(drive.lifetimeBytes / DATA_UNIT_BYTES) +
    unitsPerStep * EVAL_HOURS * 12;
  const observed = drive.used / (writtenUnits * DATA_UNIT_BYTES);
  const rated = 1 / (600 * drive.capacityBytes);
  return Math.round(
    (1 - drive.used) / (5 * 365) / Math.max(observed, rated) / 1e9,
  );
}

test("NVMe write budget follows observed or rated wear and pages over-budget drives", async () => {
  const groups = getNvmeRuleGroups();
  const budgetGroup = groups.find(
    (group) => group.name === "nvme-write-budget.rules",
  );
  const alert = groups
    .flatMap((group) => group.rules ?? [])
    .find((rule) => rule.alert === "NvmeWriteBudgetExceeded");
  if (budgetGroup === undefined || alert === undefined) {
    throw new Error("Missing NVMe write-budget rules");
  }

  const evalTime = `${String(EVAL_HOURS)}h`;
  const torvaldsPool = drives[0];
  const liskovPool = drives[1];
  const osDisk = drives[2];
  if (
    torvaldsPool === undefined ||
    liskovPool === undefined ||
    osDisk === undefined
  ) {
    throw new Error("Missing test drives");
  }
  // 250 GB/day of logical writes into the torvalds pool: 4x amplification.
  const logicalPerStep = Math.round(250e9 / STEPS_PER_DAY);
  const steps = String(EVAL_HOURS * 12 + 12);

  const directory = await mkdtemp(path.join(tmpdir(), "nvme-budget-promql-"));
  try {
    await Bun.write(
      path.join(directory, "rules.json"),
      JSON.stringify({
        groups: [
          {
            name: budgetGroup.name,
            interval: budgetGroup.interval,
            rules: (budgetGroup.rules ?? []).map((rule) => ({
              record: rule.record,
              expr: rule.expr.value,
            })),
          },
        ],
      }),
    );
    const testFile = path.join(directory, "tests.json");
    await Bun.write(
      testFile,
      JSON.stringify({
        rule_files: ["rules.json"],
        evaluation_interval: "5m",
        tests: [
          {
            interval: "5m",
            input_series: [
              ...drives.flatMap((drive) => driveSeries(drive)),
              {
                series:
                  'node_zfs_zpool_dataset_nwritten{node="torvalds",zpool="zfspv-pool-nvme",dataset="zfspv-pool-nvme/pvc-a"}',
                values: `0+${String(logicalPerStep)}x${steps}`,
              },
              // Outside the 24h window at eval time: not counted.
              claim("wp-old", "1x12"),
              claim("wp-a", `_x240 1x12`),
              claim("wp-b", `_x300 1x${String(EVAL_HOURS * 12 - 300)}`),
            ],
            promql_expr_test: [
              {
                expr: `round(${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY} / 1e9)`,
                eval_time: evalTime,
                exp_samples: drives.map((drive) => ({
                  labels: `{node="${drive.node}",instance="${drive.node}:9100",serial="${drive.serial}",model="Samsung SSD 990 PRO"}`,
                  value: expectedBudgetGb(drive),
                })),
              },
              {
                expr: `count by (serial) (${String(alert.expr.value)})`,
                eval_time: evalTime,
                exp_samples: [torvaldsPool, osDisk].map((drive) => ({
                  labels: `{serial="${drive.serial}"}`,
                  value: 1,
                })),
              },
              {
                expr: `round(${ZFS_POOL_WRITE_AMPLIFICATION_24H})`,
                eval_time: evalTime,
                exp_samples: [
                  {
                    labels: '{node="torvalds",zpool="zfspv-pool-nvme"}',
                    value: 4,
                  },
                ],
              },
              // 400 GB/day over two claims in the window.
              {
                expr: `round(${CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H} / 1e9)`,
                eval_time: evalTime,
                exp_samples: [
                  {
                    labels: '{node="liskov",zpool="zfspv-pool-nvme"}',
                    value: 200,
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    await expectPromtoolRulesPass(testFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
