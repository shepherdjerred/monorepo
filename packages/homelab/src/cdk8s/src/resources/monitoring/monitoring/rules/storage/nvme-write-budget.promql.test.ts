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
  NVME_DRIVE_WRITTEN_BYTES_24H,
  NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D,
  ZFS_POOL_WRITE_AMPLIFICATION_24H,
} from "./nvme.ts";

const DATA_UNIT_BYTES = 512_000;
const STEPS_PER_DAY = 288; // 5-minute samples
// Span > 7 days (168h) so the 7d rolling average subquery covers a full week.
const EVAL_HOURS = 174;
const DIP_SWAP_HOURS = 30;

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

function driveLabels(drive: Drive, pod = "node-exporter-a"): string {
  return `node="${drive.node}",instance="${drive.node}:9100",pod="${pod}",device="${drive.device}"`;
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

async function evaluateNvmeBudgetPromql(
  prefix: string,
  buildScenario: (alertExpr: string) => {
    input_series: unknown[];
    promql_expr_test: unknown[];
  },
): Promise<void> {
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
  const scenario = buildScenario(String(alert.expr.value));
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
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
        tests: [{ interval: "5m", ...scenario }],
      }),
    );
    await expectPromtoolRulesPass(testFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("NVMe write budget follows observed or rated wear and pages over-budget drives", async () => {
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
  // Anchor active CI workspace claims in the final 30h window so they fall
  // inside [evalTime - 24h, evalTime] just as wp-old stays well outside it.
  const recentBase = (EVAL_HOURS - 30) * 12;
  const wpAFrom = recentBase + 240;
  const wpBFrom = recentBase + 300;
  const wpCFrom = recentBase + 200;

  await evaluateNvmeBudgetPromql("nvme-budget-promql-", (alertExpr) => ({
    input_series: [
      ...drives.flatMap((drive) => driveSeries(drive)),
      {
        series:
          'node_zfs_zpool_dataset_nwritten{node="torvalds",zpool="zfspv-pool-nvme",dataset="zfspv-pool-nvme/pvc-a"}',
        values: `0+${String(logicalPerStep)}x${steps}`,
      },
      // Outside the 24h window at eval time: not counted.
      claim("wp-old", { from: 0, steps: 12 }),
      claim("wp-a", { from: wpAFrom, steps: 12 }),
      claim("wp-b", {
        from: wpBFrom,
        steps: EVAL_HOURS * 12 - wpBFrom,
      }),
      claim("wp-c", { from: wpCFrom, steps: 100 }),
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
        { from: wpAFrom, steps: 12 },
        `_x${String(wpAFrom)} 0+500000000x11`,
      ),
      ...workspace(
        "wp-b",
        "playwright-e2e",
        { from: wpBFrom, steps: EVAL_HOURS * 12 - wpBFrom },
        `_x${String(wpBFrom)} 0+100000000x20`,
      ),
      // wp-c's 3 GB belongs to the workflow's own step, the first
      // step pod created: media-pms-wire, even though
      // media-pms-native sorts first.
      ...orderedWorkspace(
        "wp-c",
        ["media-pms-wire", "media-pms-native"],
        { from: wpCFrom, steps: 100 },
        `_x${String(wpCFrom)} 0+300000000x10`,
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
        expr: `count by (serial) (${alertExpr})`,
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
  }));
}, 30_000);

type ExporterSegmentOptions = {
  pod: string;
  device: string;
  serial: string;
  capacityBytes: number;
  used: number;
  totalSamples: number;
  unitsAt: (step: number) => number;
  activeAt: (step: number) => boolean;
};

function exporterSegment({
  pod,
  device,
  serial,
  capacityBytes,
  used,
  totalSamples,
  unitsAt,
  activeAt,
}: ExporterSegmentOptions) {
  const base = `node="torvalds",instance="torvalds:9100",pod="${pod}",device="${device}"`;
  const render = (valueAt: (step: number) => number) =>
    Array.from({ length: totalSamples }, (_, step) =>
      activeAt(step) ? String(valueAt(step)) : "_",
    ).join(" ");
  return [
    {
      series: `nvme_device_info{${base},serial="${serial}",model="Samsung SSD 990 PRO"}`,
      values: render(() => 1),
    },
    {
      series: `nvme_data_units_written_total{${base}}`,
      values: render(unitsAt),
    },
    {
      series: `nvme_percentage_used_ratio{${base}}`,
      values: render(() => used),
    },
    {
      series: `nvme_physical_size_bytes{${base}}`,
      values: render(() => capacityBytes),
    },
    {
      series: `nvme_available_spare_ratio{${base}}`,
      values: render(() => 1),
    },
    {
      series: `nvme_available_spare_threshold_ratio{${base}}`,
      values: render(() => 0.1),
    },
    {
      series: `nvme_media_errors_total{${base}}`,
      values: render(() => 0),
    },
    {
      series: `nvme_temperature_celsius{${base}}`,
      values: render(() => 42),
    },
  ];
}

function serializeAllRuleGroups(groups: ReturnType<typeof getNvmeRuleGroups>) {
  return {
    groups: groups.map((group) => ({
      name: group.name,
      interval: group.interval,
      rules: (group.rules ?? []).map((rule) =>
        rule.record === undefined
          ? {
              alert: rule.alert,
              expr: rule.expr.value,
              for: rule.for,
              ...(rule.keepFiringFor === undefined
                ? {}
                : { keep_firing_for: rule.keepFiringFor }),
              labels: rule.labels,
              annotations: rule.annotations,
            }
          : {
              record: rule.record,
              expr: rule.expr.value,
            },
      ),
    })),
  };
}

function dipAndSwapInputSeries(totalSamples: number, rebootStep: number) {
  // Scenario A: liskov 2 TB pool drive at 160 TB lifetime writes (~612 GB/day
  // 5-year budget). Writes ~400 GB/day (2,737 units/step), then dips backward
  // by -4,347 units at step 200 on an unsafe shutdown before resuming:
  //   net 24h units (steps 72..360) = 287 * 2737 - 4347 = 781,172 units
  //   net 24h bytes = 781,172 * 512,000 = 399,960,064,000 (~400 GB).
  // `increase()` would treat the -4,347 dip as a reset from 0 and add +160 TB.
  const liskovStartUnits = Math.round(160e12 / DATA_UNIT_BYTES);
  const liskovUnitsPerStep = 2737;
  const unsafeShutdownDipUnits = 4347;
  const liskovUnits = Array.from({ length: totalSamples }, (_, step) =>
    step < rebootStep
      ? liskovStartUnits + step * liskovUnitsPerStep
      : liskovStartUnits +
        (step - 1) * liskovUnitsPerStep -
        unsafeShutdownDipUnits,
  ).join(" ");

  // Also verify an idle OS disk whose net 24h delta is negative (-200 units)
  // clamps cleanly to 0 rather than going negative or spiking.
  const idleStartUnits = Math.round(5e12 / DATA_UNIT_BYTES);
  const idleUnits = Array.from({ length: totalSamples }, (_, step) =>
    step < rebootStep ? idleStartUnits : idleStartUnits - 200,
  ).join(" ");

  const liskovPoolBase =
    'node="liskov",instance="liskov:9100",pod="exporter-liskov",device="nvme1n1"';
  const liskovOsBase =
    'node="liskov",instance="liskov:9100",pod="exporter-liskov",device="nvme0n1"';
  const constant = (value: number) =>
    Array.from({ length: totalSamples }, () => String(value)).join(" ");

  // Scenario B: torvalds reboots at step 200 and swaps nvme0n1 <-> nvme1n1.
  // Both `exporter-old` (steps 0..200) and `exporter-new` (steps 200..360)
  // report live samples at step 200 on the same `instance="torvalds:9100"`.
  const torvaldsPoolStart = Math.round(100e12 / DATA_UNIT_BYTES);
  const torvaldsOsStart = Math.round(10e12 / DATA_UNIT_BYTES);

  return [
    {
      series: `nvme_device_info{${liskovPoolBase},serial="S7L9NJ0L312632A",model="Samsung SSD 990 PRO"}`,
      values: constant(1),
    },
    {
      series: `nvme_data_units_written_total{${liskovPoolBase}}`,
      values: liskovUnits,
    },
    {
      series: `nvme_percentage_used_ratio{${liskovPoolBase}}`,
      values: constant(0.07),
    },
    {
      series: `nvme_physical_size_bytes{${liskovPoolBase}}`,
      values: constant(2e12),
    },
    {
      series: `nvme_device_info{${liskovOsBase},serial="OSDISKLISKOV",model="Samsung SSD 990 PRO"}`,
      values: constant(1),
    },
    {
      series: `nvme_data_units_written_total{${liskovOsBase}}`,
      values: idleUnits,
    },
    {
      series: `nvme_percentage_used_ratio{${liskovOsBase}}`,
      values: constant(0.01),
    },
    {
      series: `nvme_physical_size_bytes{${liskovOsBase}}`,
      values: constant(1e12),
    },
    ...exporterSegment({
      pod: "exporter-old",
      device: "nvme1n1",
      serial: "S7KGNU0X511734N",
      capacityBytes: 4e12,
      used: 0.05,
      totalSamples,
      unitsAt: (step) => torvaldsPoolStart + step * 1000,
      activeAt: (step) => step <= rebootStep,
    }),
    ...exporterSegment({
      pod: "exporter-old",
      device: "nvme0n1",
      serial: "OSDISKTORVALDS",
      capacityBytes: 1e12,
      used: 0.02,
      totalSamples,
      unitsAt: (step) => torvaldsOsStart + step * 100,
      activeAt: (step) => step <= rebootStep,
    }),
    ...exporterSegment({
      pod: "exporter-new",
      device: "nvme0n1",
      serial: "S7KGNU0X511734N",
      capacityBytes: 4e12,
      used: 0.05,
      totalSamples,
      unitsAt: (step) => torvaldsPoolStart + step * 1000,
      activeAt: (step) => step >= rebootStep,
    }),
    ...exporterSegment({
      pod: "exporter-new",
      device: "nvme1n1",
      serial: "OSDISKTORVALDS",
      capacityBytes: 1e12,
      used: 0.02,
      totalSamples,
      unitsAt: (step) => torvaldsOsStart + step * 100,
      activeAt: (step) => step >= rebootStep,
    }),
  ];
}

test("NVMe rules survive unsafe-shutdown firmware counter dips and overlapping reboot exporter pods", async () => {
  const groups = getNvmeRuleGroups();
  const alert = groups
    .flatMap((group) => group.rules ?? [])
    .find((rule) => rule.alert === "NvmeWriteBudgetExceeded");
  if (alert === undefined) {
    throw new Error("Missing NvmeWriteBudgetExceeded alert");
  }

  const totalSamples = DIP_SWAP_HOURS * 12 + 1; // indices 0..360 (0h..30h at 5m)
  const rebootStep = 200; // 16h40m ("1000m"), inside the [6h, 30h] 24h window
  const torvaldsPoolStart = Math.round(100e12 / DATA_UNIT_BYTES);
  const torvaldsOsStart = Math.round(10e12 / DATA_UNIT_BYTES);

  const directory = await mkdtemp(
    path.join(tmpdir(), "nvme-dip-and-swap-promql-"),
  );
  try {
    // Load ALL NVMe rule groups (`nvme.rules` + `nvme-write-budget.rules`) so
    // promtool evaluates every instant alert and subquery across the overlap.
    await Bun.write(
      path.join(directory, "rules.json"),
      JSON.stringify(serializeAllRuleGroups(groups)),
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
            input_series: dipAndSwapInputSeries(totalSamples, rebootStep),
            promql_expr_test: [
              // At the exact overlap step (200 * 5m = 1000m), joining with `pod`
              // avoids many-to-many errors and resolves each drive's true units.
              {
                expr: 'max by (serial) ((nvme_data_units_written_total{node="torvalds"}) * on(device, instance, pod) group_left(serial, model) nvme_device_info)',
                eval_time: "1000m",
                exp_samples: [
                  {
                    labels: '{serial="S7KGNU0X511734N"}',
                    value: torvaldsPoolStart + rebootStep * 1000,
                  },
                  {
                    labels: '{serial="OSDISKTORVALDS"}',
                    value: torvaldsOsStart + rebootStep * 100,
                  },
                ],
              },
              // At 30h, liskov reports ~400 GB (not +160 TB), the idle drive
              // clamps to 0, and torvalds preserves continuous per-serial
              // series across the nvme0n1 <-> nvme1n1 swap.
              {
                expr: `round(${NVME_DRIVE_WRITTEN_BYTES_24H} / 1e9)`,
                eval_time: "30h",
                exp_samples: [
                  {
                    labels:
                      '{node="liskov",instance="liskov:9100",serial="S7L9NJ0L312632A",model="Samsung SSD 990 PRO"}',
                    value: 400,
                  },
                  {
                    labels:
                      '{node="liskov",instance="liskov:9100",serial="OSDISKLISKOV",model="Samsung SSD 990 PRO"}',
                    value: 0,
                  },
                  {
                    labels:
                      '{node="torvalds",instance="torvalds:9100",serial="S7KGNU0X511734N",model="Samsung SSD 990 PRO"}',
                    value: 147,
                  },
                  {
                    labels:
                      '{node="torvalds",instance="torvalds:9100",serial="OSDISKTORVALDS",model="Samsung SSD 990 PRO"}',
                    value: 15,
                  },
                ],
              },
              // None of the four under-budget drives fire NvmeWriteBudgetExceeded.
              {
                expr: String(alert.expr.value),
                eval_time: "30h",
                exp_samples: [],
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
}, 30_000);

test("NvmeWriteBudgetExceeded ignores single-day write bursts when the 7-day average stays within budget", async () => {
  // 2 TB drive at 7% wear (~612 GB/day 5-year budget): 6 days at 300 GB/day
  // followed by 1 busy day at 900 GB/day. The 24h counter exceeds the daily
  // budget (900 GB > 612 GB), while the 7d average ((6*300 + 900)/7 = 386 GB)
  // stays well below budget so NvmeWriteBudgetExceeded does not flap.
  const calmSteps = 6 * STEPS_PER_DAY;
  const burstSteps = STEPS_PER_DAY;
  const totalSamples = calmSteps + burstSteps + 1;
  const startUnits = Math.round(129e12 / DATA_UNIT_BYTES);
  const calmUnitsPerStep = Math.round(300e9 / STEPS_PER_DAY / DATA_UNIT_BYTES);
  const burstUnitsPerStep = Math.round(900e9 / STEPS_PER_DAY / DATA_UNIT_BYTES);
  const writtenValues = Array.from({ length: totalSamples }, (_, step) =>
    step <= calmSteps
      ? String(startUnits + step * calmUnitsPerStep)
      : String(
          startUnits +
            calmSteps * calmUnitsPerStep +
            (step - calmSteps) * burstUnitsPerStep,
        ),
  ).join(" ");
  const baseLabels =
    'node="liskov",instance="liskov:9100",pod="node-exporter-a",device="nvme1n1"';
  const constant = (value: number) =>
    `${String(value)}x${String(totalSamples)}`;

  await evaluateNvmeBudgetPromql("nvme-burst-promql-", (alertExpr) => ({
    input_series: [
      {
        series: `nvme_device_info{${baseLabels},serial="S7L9NJ0L312632A",model="Samsung SSD 990 PRO"}`,
        values: constant(1),
      },
      {
        series: `nvme_data_units_written_total{${baseLabels}}`,
        values: writtenValues,
      },
      {
        series: `nvme_percentage_used_ratio{${baseLabels}}`,
        values: constant(0.07),
      },
      {
        series: `nvme_physical_size_bytes{${baseLabels}}`,
        values: constant(2e12),
      },
    ],
    promql_expr_test: [
      // Single-day writes genuinely cross the 5-year daily budget (~900 GB > ~612 GB)...
      {
        expr: `count(${NVME_DRIVE_WRITTEN_BYTES_24H} > on(node, instance, serial, model) ${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY})`,
        eval_time: "168h",
        exp_samples: [{ labels: "{}", value: 1 }],
      },
      // ...while the 7-day rolling average stays around 386 GB/day, so the alert stays quiet.
      {
        expr: `round(${NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D} / 1e9)`,
        eval_time: "168h",
        exp_samples: [
          {
            labels:
              '{node="liskov",instance="liskov:9100",serial="S7L9NJ0L312632A",model="Samsung SSD 990 PRO"}',
            value: 386,
          },
        ],
      },
      {
        expr: alertExpr,
        eval_time: "168h",
        exp_samples: [],
      },
    ],
  }));
}, 30_000);
