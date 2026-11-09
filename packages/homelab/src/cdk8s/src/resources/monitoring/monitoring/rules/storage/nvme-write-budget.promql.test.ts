import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { expectPromtoolRulesPass } from "./promtool-test.ts";
import {
  CI_STEP_WORKSPACE_LOGICAL_BYTES_24H,
  CI_STEP_WORKSPACES_24H,
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

// When a workflow's pods were created. The rules only compare pods on one
// claim, so a fixed epoch is enough; the clone pod comes first, step pods
// follow at the offsets below.
const CREATED_EPOCH = 1_762_560_000;

// A series present for `steps` samples starting at sample `from`.
type Presence = { from: number; steps: number };

function presence(value: number, { from, steps }: Presence): string {
  const gap = from > 0 ? `_x${String(from)} ` : "";
  return `${gap}${String(value)}x${String(steps)}`;
}

function claim(name: string, present: Presence) {
  return {
    series: `kube_persistentvolumeclaim_info{namespace="woodpecker-ci",persistentvolumeclaim="${name}",storageclass="ci-workspace",volumename="pvc-${name}"}`,
    values: presence(1, present),
  };
}

type StepPod = { step: string; createdAfterSeconds: number };

// A workspace claim's dataset, its clone pod (no step key), and the step
// pods that mounted it, each with its own step key and creation time.
function workspacePods(
  name: string,
  steps: readonly StepPod[],
  present: Presence,
  writes: string,
) {
  const pod = (podName: string, createdAt: number, labels: string) => [
    {
      series: `kube_pod_spec_volumes_persistentvolumeclaims_info{namespace="woodpecker-ci",persistentvolumeclaim="${name}",pod="${podName}"}`,
      values: presence(1, present),
    },
    {
      series: `kube_pod_labels{namespace="woodpecker-ci",pod="${podName}"${labels}}`,
      values: presence(1, present),
    },
    {
      series: `kube_pod_created{namespace="woodpecker-ci",pod="${podName}"}`,
      values: presence(createdAt, present),
    },
  ];
  return [
    {
      series: `node_zfs_zpool_dataset_nwritten{node="liskov",zpool="zfspv-pool-nvme",dataset="zfspv-pool-nvme/pvc-${name}"}`,
      values: writes,
    },
    ...pod(`${name}-clone`, CREATED_EPOCH, ""),
    ...steps.flatMap(({ step, createdAfterSeconds }, index) =>
      pod(
        `${name}-step-${String(index)}`,
        CREATED_EPOCH + createdAfterSeconds,
        `,label_ci_sjer_red_step_key="${step}"`,
      ),
    ),
  ];
}

// The common workflow: one step pod on the claim.
function workspace(
  name: string,
  step: string,
  present: Presence,
  writes: string,
) {
  return workspacePods(
    name,
    [{ step, createdAfterSeconds: 30 }],
    present,
    writes,
  );
}

// A workflow with ordered containers (media-pms-wire then media-pms-native,
// small-pr-checks): several step pods, each under its own step key, mount
// the one claim in sequence, ten minutes apart.
function orderedWorkspace(
  name: string,
  steps: readonly string[],
  present: Presence,
  writes: string,
) {
  return workspacePods(
    name,
    steps.map((step, index) => ({
      step,
      createdAfterSeconds: 30 + index * 600,
    })),
    present,
    writes,
  );
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
              claim("wp-old", { from: 0, steps: 12 }),
              claim("wp-a", { from: 240, steps: 12 }),
              claim("wp-b", { from: 300, steps: EVAL_HOURS * 12 - 300 }),
              claim("wp-c", { from: 200, steps: 100 }),
              // wp-old's 9 GB is outside the window; wp-a wrote 5.5 GB and
              // wp-b 2 GB, each counted once despite its clone pod.
              ...workspace(
                "wp-old",
                "verify",
                { from: 0, steps: 12 },
                "0+1000000000x9",
              ),
              ...workspace(
                "wp-a",
                "verify",
                { from: 240, steps: 12 },
                "_x240 0+500000000x11",
              ),
              ...workspace(
                "wp-b",
                "playwright-e2e",
                { from: 300, steps: EVAL_HOURS * 12 - 300 },
                "_x300 0+100000000x20",
              ),
              // wp-c's 3 GB belongs to the workflow's own step, the first
              // step pod created: media-pms-wire, even though
              // media-pms-native sorts first.
              ...orderedWorkspace(
                "wp-c",
                ["media-pms-wire", "media-pms-native"],
                { from: 200, steps: 100 },
                "_x200 0+300000000x10",
              ),
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
                expr: `round(${ZFS_POOL_WRITE_AMPLIFICATION_24H}{node="torvalds"})`,
                eval_time: evalTime,
                exp_samples: [
                  {
                    labels: '{node="torvalds",zpool="zfspv-pool-nvme"}',
                    value: 4,
                  },
                ],
              },
              // 400 GB/day over three claims in the window.
              {
                expr: `round(${CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H} / 1e9)`,
                eval_time: evalTime,
                exp_samples: [
                  {
                    labels: '{node="liskov",zpool="zfspv-pool-nvme"}',
                    value: 133,
                  },
                ],
              },
              {
                expr: `${CI_STEP_WORKSPACE_LOGICAL_BYTES_24H} / 1e8`,
                eval_time: evalTime,
                exp_samples: [
                  { labels: '{step="verify"}', value: 55 },
                  { labels: '{step="playwright-e2e"}', value: 20 },
                  { labels: '{step="media-pms-wire"}', value: 30 },
                ],
              },
              {
                expr: `${CI_STEP_WORKSPACES_24H} + 0`,
                eval_time: evalTime,
                exp_samples: [
                  { labels: '{step="verify"}', value: 1 },
                  { labels: '{step="playwright-e2e"}', value: 1 },
                  { labels: '{step="media-pms-wire"}', value: 1 },
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
