import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import {
  CI_NODE_HOSTNAME,
  PROD_NODE_HOSTNAME,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { CI_WORKSPACE_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

// nvme_* metrics are keyed by `device` (e.g. nvme0n1) — the kernel's NVMe
// enumeration name, which is NOT stable across reboots or slot changes. The
// stable serial + model live only on the nvme_device_info metric, so join it in
// via group_left: every alert then carries `serial` and `model` and identifies
// the physical drive instead of an enumeration slot. `pod` is required in the
// join key because `node-exporter` uses `hostNetwork`: across a reboot that
// swaps `nvme0n1` <-> `nvme1n1`, pre- and post-reboot pods share `(device,
// instance)` inside Prometheus's 5m staleness window and fail `many-to-many`
// without `pod`, while `bySerial` still aggregates `max by (node, instance,
// serial, model)` into one continuous series per drive. nvme_device_info has
// value 1, so the multiplication leaves the alert's `$value` unchanged.
function withNvmeIdentity(expr: string): string {
  return `(${expr}) * on(device, instance, pod) group_left(serial, model) nvme_device_info`;
}

// Rate and trend rules look back days, across reboots that can swap device
// names. Aggregating the identity-joined series by serial before the range
// subquery keeps one continuous series per physical drive; a device-keyed range
// would splice two drives together after a swap. `node` rides along so the
// pool and per-node rules can join on it.
function bySerial(metric: string): string {
  return `max by (node, instance, serial, model) (${withNvmeIdentity(metric)})`;
}

// nvme_data_units_written_total counts units of 1000 512-byte sectors.
const NVME_DATA_UNIT_BYTES = 512_000;

/**
 * Each `zfspv-pool-nvme` pool is one whole NVMe drive (see the ZFS pool
 * creation steps in packages/homelab/README.md). No exported metric links a
 * pool to its vdev, so the pairing is declared here, and replacing a pool drive
 * must update its serial. The other NVMe on each node is the Talos OS disk,
 * selected by serial in src/talos/<node>/patches/image.yaml.
 */
export const NVME_POOL_DRIVES = [
  {
    node: PROD_NODE_HOSTNAME,
    zpool: "zfspv-pool-nvme",
    serial: "S7KGNU0X511734N",
  },
  {
    node: CI_NODE_HOSTNAME,
    zpool: "zfspv-pool-nvme",
    serial: "S7L9NJ0L312632A",
  },
] as const;

// Samsung 990 PRO endurance: 600 TBW per TB of capacity over the warranty.
const RATED_WRITES_PER_CAPACITY = 600;
// Every drive's write budget spends its remaining life over this many years.
const WRITE_BUDGET_YEARS = 5;
const DAYS_PER_YEAR = 365;

// Recorded series. Drive series carry (node, instance, serial, model); pool
// series carry (node, zpool). Bytes are decimal, so Grafana's `decbytes` unit
// reads them directly as GB.
export const NVME_DRIVE_WRITTEN_BYTES_24H =
  "nvme_drive:physical_written_bytes:increase24h";
export const NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D =
  "nvme_drive:physical_written_bytes_per_day:avg7d";
export const NVME_DRIVE_WEAR_PER_WRITTEN_BYTE =
  "nvme_drive:wear_ratio_per_written_byte:conservative";
export const NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY =
  "nvme_drive:write_budget_bytes_per_day:5y";
export const ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H =
  "zfs_pool:logical_written_bytes:increase24h";
export const ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H =
  "zfs_pool:physical_written_bytes:increase24h";
export const ZFS_POOL_WRITE_AMPLIFICATION_24H =
  "zfs_pool:write_amplification:ratio24h";
export const CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H =
  "ci_workspace:physical_written_bytes_per_pvc:ratio24h";
// CI series carry `step`, the workflow's ci.sjer.red/step-key pod label.
export const CI_STEP_WORKSPACE_LOGICAL_BYTES_24H =
  "ci_step:workspace_logical_written_bytes:sum24h";
export const CI_STEP_WORKSPACES_24H = "ci_step:workspaces:count24h";
// CI pool logical bytes written in 24h, by `writer` (see CI_POOL_WRITERS).
export const CI_POOL_WRITER_LOGICAL_BYTES_24H =
  "ci_pool:writer_logical_written_bytes:sum24h";

/**
 * Who writes to the CI pool (liskov `zfspv-pool-nvme`), classified by the claim
 * that owns each dataset:
 *  - workspaces: claims of the `ci-workspace` class in the CI namespace
 *  - buildkit: claims in the `buildkitd` namespace
 *  - delivery: claims in any `delivery-*` namespace (stage and platform jobs)
 *  - caches: every other claim (Bun, Go, Cargo, Turbo and similar caches)
 *  - other: datasets no claim owns (orphans, non-PVC datasets)
 */
export const CI_POOL_WRITERS = [
  "workspaces",
  "buildkit",
  "delivery",
  "caches",
  "other",
] as const;
export type CiPoolWriter = (typeof CI_POOL_WRITERS)[number];

const BYTES_PER_GB = 1_000_000_000;

/**
 * Daily logical-write TARGETS per writer, in decimal bytes: where the CI write
 * program (Forum FM-275) is taking each writer. They sum to 470 GB, under the
 * CI pool drive's 500 GB/day target (the pool's physical writes run within
 * about 10% of its logical writes). `other` has no target: it is the residue
 * no owner is responsible for. The dashboard panel shows these; the alerts
 * below use CI_POOL_WRITER_ALERT_THRESHOLD_BYTES instead.
 */
export const CI_POOL_WRITER_TARGET_BYTES = {
  workspaces: 250 * BYTES_PER_GB,
  buildkit: 100 * BYTES_PER_GB,
  delivery: 50 * BYTES_PER_GB,
  caches: 70 * BYTES_PER_GB,
} as const satisfies Partial<Record<CiPoolWriter, number>>;

const CI_POOL_WRITER_TARGET_TOTAL_BYTES = Object.values(
  CI_POOL_WRITER_TARGET_BYTES,
).reduce((total, target) => total + target, 0);

/**
 * Alert thresholds: regression guards, not targets.
 *
 * Workspaces, BuildKit and Delivery ran 3-12x over their targets on every one
 * of the 14 days to 2026-11-26, so alerting at the targets would email on
 * deploy and never clear. Each threshold sits just above that writer's 14-day
 * p90 of daily writes (p90 / max, GB: workspaces 2,542 / 2,997; buildkit
 * 975 / 1,663; delivery 510 / 623; caches 67 / 100), so only a day worse than
 * nearly every recent day pages. Caches' p90 is already under its 70 GB
 * target, so it alerts at the target. As the CI write program (Forum FM-275)
 * lands each fix, ratchet the threshold down toward its target.
 */
export const CI_POOL_WRITER_ALERT_THRESHOLD_BYTES = {
  workspaces: 2600 * BYTES_PER_GB,
  buildkit: 1000 * BYTES_PER_GB,
  delivery: 550 * BYTES_PER_GB,
  caches: 70 * BYTES_PER_GB,
} as const satisfies Record<keyof typeof CI_POOL_WRITER_TARGET_BYTES, number>;

/** The CI pool drive's daily write target, drawn as a line on the dashboard. */
export const CI_POOL_DAILY_WRITE_TARGET_BYTES = 500 * BYTES_PER_GB;

// One alert per writer with a target. The copy names the writer in plain
// English rather than interpolating raw machine labels.
const CI_POOL_WRITER_ALERTS = [
  {
    writer: "workspaces",
    alert: "CIPoolWorkspaceWritesRegressed",
    summary: "CI workspaces are writing more than they have recently",
    description:
      "Per-workflow CI workspace volumes are writing more to the CI pool than on nearly any recent day, wearing the pool drive faster. Check the golden workspace freshness and the largest steps under CI Workspace Writes by Step.",
  },
  {
    writer: "buildkit",
    alert: "CIPoolBuildkitWritesRegressed",
    summary: "BuildKit is writing more than it has recently",
    description:
      "BuildKit's cache volume is writing more to the CI pool than on nearly any recent day, wearing the pool drive faster. Look for images that are rebuilt, pushed and pulled without changing.",
  },
  {
    writer: "delivery",
    alert: "CIPoolDeliveryWritesRegressed",
    summary: "Delivery jobs are writing more than they have recently",
    description:
      "Delivery stage and platform job volumes are writing more to the CI pool than on nearly any recent day, wearing the pool drive faster. Look for jobs that re-clone or rebuild unchanged inputs on every run.",
  },
  {
    writer: "caches",
    alert: "CIPoolCacheWritesRegressed",
    summary: "CI caches are writing more than their daily target",
    description:
      "The shared CI cache volumes (Bun, Go, Cargo, Turbo and similar) are writing more to the CI pool than their target, wearing the pool drive faster. A cache that is rewritten instead of reused usually means a broken cache key or a garbage collector fighting its writers.",
  },
] as const satisfies readonly {
  writer: keyof typeof CI_POOL_WRITER_TARGET_BYTES;
  alert: string;
  summary: string;
  description: string;
}[];

/** How long a writer must stay over its threshold before it alerts. */
const CI_POOL_WRITER_ALERT_FOR = "6h";

const usedRatio = bySerial("nvme_percentage_used_ratio");
const lifetimeWrittenBytes = `${bySerial("nvme_data_units_written_total")} * ${String(NVME_DATA_UNIT_BYTES)}`;
const capacityBytes = bySerial("nvme_physical_size_bytes");

// Wear per written byte, taking whichever of two estimates wears faster:
//  - observed: SMART percentage_used over lifetime bytes written. This is the
//    drive's real per-byte wear including its internal amplification (the
//    torvalds pool drive, ashift=9, wears about twice as fast as rated).
//  - rated: one full life per RATED_WRITES_PER_CAPACITY capacities written.
// percentage_used moves in whole-percent steps, so a young drive's observed
// figure is 0 or coarse. The rated floor keeps its budget finite and sane
// instead of dividing by zero; clamp_min guards a zero byte count.
const observedWearPerByte = `${usedRatio} / clamp_min(${lifetimeWrittenBytes}, 1)`;
const ratedWearPerByte = `1 / (${String(RATED_WRITES_PER_CAPACITY)} * ${capacityBytes})`;

// Each pool drive's physical writes, re-keyed by (node, zpool).
const poolPhysicalWrites = NVME_POOL_DRIVES.map(
  ({ node, zpool, serial }) =>
    `max by (node, zpool) (label_replace(${NVME_DRIVE_WRITTEN_BYTES_24H}{node="${node}",serial="${serial}"}, "zpool", "${zpool}", "", ""))`,
).join(" or ");

/**
 * Logical bytes each CI workspace claim wrote in the last 24h, labelled by
 * claim. A workspace dataset lives for minutes and its nwritten counter starts
 * at zero, so its last scraped value is its total; increase() would drop the
 * bytes written before the first scrape. Writes after the final scrape before
 * the dataset is destroyed are still lost. Claims still Pending carry an empty
 * volumename and are skipped.
 */
function ciWorkspaceWrites(node: string, zpool: string): string {
  const datasetWrites = `label_replace(max by (dataset) (max_over_time(node_zfs_zpool_dataset_nwritten{node="${node}",dataset=~"${zpool}/pvc-.*"}[24h])), "volumename", "$1", "dataset", "[^/]+/(.+)")`;
  const claims = `max by (volumename, persistentvolumeclaim) (last_over_time(kube_persistentvolumeclaim_info{namespace="${WOODPECKER_CI_NAMESPACE}",storageclass="${CI_WORKSPACE_STORAGE_CLASS}",volumename!=""}[24h]))`;
  return `(${datasetWrites} * on(volumename) group_left(persistentvolumeclaim) ${claims})`;
}

/**
 * Every step pod that mounted a workspace claim in the window, keyed by
 * (claim, pod, step key). Clone pods carry no step key and drop out of the
 * join.
 */
const ciStepPods = `max by (persistentvolumeclaim, pod, label_ci_sjer_red_step_key) (last_over_time(kube_pod_spec_volumes_persistentvolumeclaims_info{namespace="${WOODPECKER_CI_NAMESPACE}",persistentvolumeclaim=~"wp-.*"}[24h]) * on(pod) group_left(label_ci_sjer_red_step_key) max by (pod, label_ci_sjer_red_step_key) (last_over_time(kube_pod_labels{namespace="${WOODPECKER_CI_NAMESPACE}",label_ci_sjer_red_step_key!=""}[24h])))`;

/**
 * Each workspace claim's step. A workflow with ordered containers
 * (media-pms-wire then media-pms-native, small-pr-checks) runs several step
 * pods on one claim, each under its own step key, so the claim is attributed
 * to its earliest-created step pod: the workflow's own step. bottomk over the
 * pods' creation times picks it; `> bool 0` turns the timestamp back into a
 * join weight of 1.
 */
const ciClaimSteps = `label_replace(max by (persistentvolumeclaim, label_ci_sjer_red_step_key) (bottomk by (persistentvolumeclaim) (1, ${ciStepPods} * on(pod) group_left() max by (pod) (last_over_time(kube_pod_created{namespace="${WOODPECKER_CI_NAMESPACE}"}[24h]))) > bool 0), "step", "$1", "label_ci_sjer_red_step_key", "(.+)")`;

/**
 * Logical bytes written to the pool in the last 24h, by owning writer, as one
 * `writer`-labelled series each.
 *
 * A dataset that was scraped in the 24h before the window is measured with
 * `increase()`. That is exact for a long-lived cache, and it also sums the
 * per-mount sessions of a volume that is mounted and unmounted all day (a
 * mount restarts `nwritten` at zero, which `increase()` counts as a reset;
 * the Delivery stage workspaces wrote 300+ GB this way while their maximum
 * never passed 5 GB). A dataset first scraped inside the window starts at zero
 * and may be destroyed within minutes, so `increase()` would drop the bytes
 * written before its first scrape; its last scraped value (`max_over_time`) is
 * its whole lifetime, the same treatment `ciWorkspaceWrites` gives workspace
 * claims.
 *
 * `increase()` is summed per dataset, not maxed: a node-exporter restart gives
 * every dataset a new `pod` label, splitting it into two series inside the
 * window, and `max` would keep only the larger piece (a backtest 10h after a
 * restart summed to 81% of the pool). The `max_over_time` side stays `max`, as
 * the pieces' lifetimes overlap rather than add.
 *
 * Each dataset `<pool>/<pv name>` joins the claim that owns the volume, from
 * `kube_persistentvolumeclaim_info` over the same window so destroyed claims
 * still classify. `topk` keeps one claim per volume: a restore claim can name
 * a volume another namespace's claim already owns, and a duplicate would fail
 * the join. The later `label_replace` calls override the `caches` default for
 * the claims that match their class.
 */
function ciPoolWritesByWriter(node: string, zpool: string): string {
  const dataset = `node_zfs_zpool_dataset_nwritten{node="${node}",zpool="${zpool}"}`;
  const scrapedBeforeWindow = `max by (dataset) (count_over_time(${dataset}[24h] offset 24h))`;
  const datasetWrites = `(
  (sum by (dataset) (increase(${dataset}[24h])) and on (dataset) ${scrapedBeforeWindow})
  or
  (max by (dataset) (max_over_time(${dataset}[24h])) unless on (dataset) ${scrapedBeforeWindow})
)`;
  const withVolume = `label_replace(${datasetWrites}, "volumename", "$1", "dataset", "[^/]+/(.+)")`;
  const claims = `topk by (volumename) (1, max by (volumename, namespace, storageclass) (last_over_time(kube_persistentvolumeclaim_info{volumename!=""}[24h])))`;
  const claimed = `label_join(${withVolume} * on (volumename) group_left (namespace, storageclass) ${claims}, "claim_class", "/", "namespace", "storageclass")`;
  const writers = [
    ["workspaces", `${WOODPECKER_CI_NAMESPACE}/${CI_WORKSPACE_STORAGE_CLASS}`],
    ["buildkit", "buildkitd/.*"],
    ["delivery", "delivery-[^/]*/.*"],
  ] as const satisfies readonly (readonly [CiPoolWriter, string])[];
  const classified = writers.reduce(
    (expression, [writer, classPattern]) =>
      `label_replace(${expression}, "writer", "${writer}", "claim_class", "${classPattern}")`,
    `label_replace(${claimed}, "writer", "caches", "", "")`,
  );
  const unclaimed = `label_replace(${withVolume} unless on (volumename) ${claims}, "writer", "other", "", "")`;
  return `sum by (writer) (${classified} or ${unclaimed})`;
}

function ciPoolDrive(): (typeof NVME_POOL_DRIVES)[number] {
  const drive = NVME_POOL_DRIVES.find(
    (candidate) => candidate.node === CI_NODE_HOSTNAME,
  );
  if (drive === undefined) {
    throw new Error("The CI node's NVMe pool drive must be declared");
  }
  return drive;
}

/**
 * Write-budget recording rules. Evaluated every 5 minutes: they summarize
 * day-scale windows, so a faster cadence would only repeat the same subquery
 * work.
 */
function getNvmeWriteBudgetRuleGroup(): PrometheusRuleSpecGroups {
  const ciPool = ciPoolDrive();
  return {
    name: "nvme-write-budget.rules",
    interval: "5m",
    rules: [
      // Physical bytes the host wrote to each drive: what wears the flash.
      // `nvme_data_units_written_total` is a non-volatile SMART firmware counter
      // that never resets to 0, whereas consumer SSDs without power-loss
      // protection can step backward slightly after an unsafe shutdown, causing
      // `increase()` to hallucinate a lifetime-TBW reset. `clamp_min(delta(...), 0)`
      // measures the true net physical writes without phantom reset spikes.
      {
        record: NVME_DRIVE_WRITTEN_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `clamp_min(delta(${bySerial("nvme_data_units_written_total")}[24h:5m]), 0) * ${String(NVME_DATA_UNIT_BYTES)}`,
        ),
      },
      {
        record: NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `clamp_min(delta(${bySerial("nvme_data_units_written_total")}[7d:1h]), 0) * ${String(NVME_DATA_UNIT_BYTES)} / 7`,
        ),
      },
      {
        record: NVME_DRIVE_WEAR_PER_WRITTEN_BYTE,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `((${observedWearPerByte}) >= (${ratedWearPerByte})) or (${ratedWearPerByte})`,
        ),
      },
      // Bytes per day that spend the remaining life over WRITE_BUDGET_YEARS:
      // (1 - used) / (years * 365) / wear per byte.
      {
        record: NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `clamp_min(1 - ${usedRatio}, 0) / ${String(WRITE_BUDGET_YEARS * DAYS_PER_YEAR)} / on(node, instance, serial, model) ${NVME_DRIVE_WEAR_PER_WRITTEN_BYTE}`,
        ),
      },
      // Logical bytes applications wrote into each pool's datasets. A dataset
      // destroyed inside the window loses its last unscraped writes, so this
      // slightly understates churny pools such as the CI pool.
      {
        record: ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "sum by (node, zpool) (increase(node_zfs_zpool_dataset_nwritten[24h]))",
        ),
      },
      {
        record: ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(poolPhysicalWrites),
      },
      // Physical bytes reaching the flash per logical byte written: record
      // size, metadata, ZIL, and copy-on-write overhead together.
      {
        record: ZFS_POOL_WRITE_AMPLIFICATION_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `${ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H} / on(node, zpool) (${ZFS_POOL_LOGICAL_WRITTEN_BYTES_24H} > 0)`,
        ),
      },
      // CI pool physical bytes per workspace claim that existed in the window.
      // Counting by (namespace, claim) dedupes series a kube-state-metrics
      // restart splits.
      {
        record: CI_WORKSPACE_PHYSICAL_BYTES_PER_PVC_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `${ZFS_POOL_PHYSICAL_WRITTEN_BYTES_24H}{node="${ciPool.node}",zpool="${ciPool.zpool}"} / on() group_left() (count(count by (namespace, persistentvolumeclaim) (last_over_time(kube_persistentvolumeclaim_info{storageclass="${CI_WORKSPACE_STORAGE_CLASS}"}[24h]))) > 0)`,
        ),
      },
      // Where the CI pool's workspace bytes go, by step. Bytes per workspace
      // is the logical sum over the count; physical is that times the pool's
      // amplification.
      {
        record: CI_STEP_WORKSPACE_LOGICAL_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `sum by (step) (${ciWorkspaceWrites(ciPool.node, ciPool.zpool)} * on(persistentvolumeclaim) group_left(step) max by (persistentvolumeclaim, step) (${ciClaimSteps}))`,
        ),
      },
      {
        record: CI_STEP_WORKSPACES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `count by (step) (${ciWorkspaceWrites(ciPool.node, ciPool.zpool)} * on(persistentvolumeclaim) group_left(step) max by (persistentvolumeclaim, step) (${ciClaimSteps}))`,
        ),
      },
      // Who wrote the CI pool's bytes: the per-writer budget alerts and the
      // SMART dashboard's writers panel read this.
      {
        record: CI_POOL_WRITER_LOGICAL_BYTES_24H,
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          ciPoolWritesByWriter(ciPool.node, ciPool.zpool),
        ),
      },
    ],
  };
}

// Days until SMART percentage_used reaches 1.0 at the last 14 days' wear rate.
// percentage_used moves in whole-percent steps, so a shorter window is too
// coarse. A drive with no recent wear divides by zero and yields +Inf.
const projectedWearOutDays = `(1 - ${bySerial("nvme_percentage_used_ratio")}) / (delta(${bySerial("nvme_percentage_used_ratio")}[14d:1h]) / 14)`;

export function getNvmeRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "nvme.rules",
      interval: "1m",
      rules: [
        // NVMe controller-reported wear (percentage_used_ratio: 0.0 = unused, 1.0 = end-of-life).
        // Source: nvme-cli SMART/Health Information log, surfaced by node-exporter's nvme collector.
        // This is the actually-working SSD wear metric on this cluster — smartmon_wear_leveling_count_value
        // is not reported (see TODO in smartctl.ts).
        {
          alert: "NvmePercentageUsedHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_percentage_used_ratio > 0.5"),
          ),
          for: "1h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "SSD wear has passed 50%",
            description: escapePrometheusTemplate(
              "NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}, {{ $labels.device }}) has consumed {{ $value | humanizePercentage }} of its rated endurance, reducing remaining flash lifespan. Review write-heavy workloads on the drive and plan a replacement.",
            ),
          },
        },
        {
          alert: "NvmePercentageUsedCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_percentage_used_ratio > 0.8"),
          ),
          for: "10m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SSD wear has passed 80%",
            description: escapePrometheusTemplate(
              "NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}, {{ $labels.device }}) has consumed {{ $value | humanizePercentage }} of its rated endurance and is approaching end of life. Replace the drive before rated wear reaches 100%.",
            ),
          },
        },

        // Wear velocity. The absolute thresholds above fire only once half the
        // drive's rated life is gone; these fire on the trend, while there is
        // still time to cut writes or schedule a replacement.
        //
        // The write budget covers every NVMe, OS disks included, over a 7-day
        // rolling daily write average rather than a single 24h window: a single
        // busy day or overnight lull near the 5-year budget does not flap the
        // alert, while sustained multi-day over-budget writes (including a new
        // workload landing on an OS disk) still surface within days rather than
        // waiting weeks for SMART wear percentages to step up.
        {
          alert: "NvmeWriteBudgetExceeded",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D} > on(node, instance, serial, model) ${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY}`,
          ),
          for: "2h",
          keepFiringFor: "6h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "SSD 7-day write rate exceeded its 5-year budget",
            description: escapePrometheusTemplate(
              `NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}) on {{ $labels.node }} averaged {{ $value | humanize }}B/day of physical writes over the last 7 days, exceeding the daily budget needed for a ${String(WRITE_BUDGET_YEARS)}-year lifespan. Inspect the top-datasets panel on the SMART Monitoring dashboard to identify and reduce the heaviest writers.`,
            ),
          },
        },
        ...CI_POOL_WRITER_ALERTS.map(
          ({ writer, alert, summary, description }) => ({
            alert,
            expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
              `${CI_POOL_WRITER_LOGICAL_BYTES_24H}{writer="${writer}"} > ${String(CI_POOL_WRITER_ALERT_THRESHOLD_BYTES[writer])}`,
            ),
            for: CI_POOL_WRITER_ALERT_FOR,
            labels: {
              severity: "warning",
              category: "ci",
              namespace: WOODPECKER_CI_NAMESPACE,
            },
            annotations: {
              summary,
              description: escapePrometheusTemplate(
                `${description} It wrote {{ $value | humanize }}B to the CI pool in the last 24 hours against an alert threshold of ${String(CI_POOL_WRITER_ALERT_THRESHOLD_BYTES[writer] / BYTES_PER_GB)} GB and a target of ${String(CI_POOL_WRITER_TARGET_BYTES[writer] / BYTES_PER_GB)} GB. The writer targets add up to ${String(CI_POOL_WRITER_TARGET_TOTAL_BYTES / BYTES_PER_GB)} GB of the pool drive's ${String(CI_POOL_DAILY_WRITE_TARGET_BYTES / BYTES_PER_GB)} GB/day goal; the CI Pool Writes by Writer panel on the SMART Monitoring dashboard shows the split.`,
              ),
            },
          }),
        ),
        {
          alert: "NvmeWearOutProjectedWithinYear",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${projectedWearOutDays}) < 365`,
          ),
          for: "6h",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "SSD is projected to wear out within a year",
            description: escapePrometheusTemplate(
              'At its 14-day wear rate, NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}) on {{ $labels.node }} will reach 100% rated wear in about {{ $value | printf "%.0f" }} days. Review sustained write amplification or plan a drive replacement.',
            ),
          },
        },
        {
          alert: "NvmeWearOutProjectedWithinSixMonths",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${projectedWearOutDays}) < 180`,
          ),
          for: "6h",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SSD is projected to wear out within 6 months",
            description: escapePrometheusTemplate(
              'At its 14-day wear rate, NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}) on {{ $labels.node }} will reach 100% rated wear in about {{ $value | printf "%.0f" }} days, risking premature failure. Replace the drive soon and cut write-heavy workloads immediately.',
            ),
          },
        },

        // Available spare capacity. Drops below firmware-defined threshold means
        // reserved blocks for replacement are exhausting; failure is approaching
        // even before percentage_used hits 1.0.
        {
          alert: "NvmeAvailableSpareLow",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity(
              "nvme_available_spare_ratio < nvme_available_spare_threshold_ratio",
            ),
          ),
          for: "10m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SSD spare flash blocks are running low",
            description: escapePrometheusTemplate(
              "NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}, {{ $labels.device }}) has {{ $value | humanizePercentage }} available spare blocks remaining, below the firmware warning threshold, indicating flash block exhaustion. Replace the drive promptly after verifying critical data backups.",
            ),
          },
        },

        // Any media error indicates uncorrectable read/write failures at the NAND level.
        {
          alert: "NvmeMediaErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("increase(nvme_media_errors_total[1h]) > 0"),
          ),
          for: "5m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SSD reported unrecoverable flash media errors",
            description: escapePrometheusTemplate(
              'NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}, {{ $labels.device }}) recorded {{ $value | printf "%.0f" }} uncorrectable media or data-integrity error(s) in the last hour, risking data corruption or read failures. Check kernel logs and ZFS pool status on the host, and schedule a drive replacement.',
            ),
          },
        },

        // Thermal alerts using the nvme_temperature_celsius metric (node-exporter
        // nvme collector), which emits proper `device=nvme[0-9]+n[0-9]+` labels.
        // The smartmon collector emits temperature without a usable device label
        // for NVMe, so NVMe temperature is owned here, not in smartctl.ts (whose
        // temp alerts are now scoped to SATA via type="sat").
        // Samsung 990 PRO rated operating max is 70°C; warn at 65°C before
        // Dynamic Thermal Guard throttles write bandwidth (which can extend CI
        // burst windows in a self-reinforcing loop above 70°C).
        {
          alert: "NvmeTemperatureHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_temperature_celsius > 65"),
          ),
          for: "5m",
          labels: {
            severity: "warning",
            category: "hardware",
          },
          annotations: {
            summary: "SSD temperature is high",
            description: escapePrometheusTemplate(
              "NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}, {{ $labels.device }}) is at {{ $value }}°C, approaching its 70°C thermal throttling limit. Check chassis airflow, heatsink contact, and sustained disk I/O on the host.",
            ),
          },
        },
        {
          alert: "NvmeTemperatureCritical",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            withNvmeIdentity("nvme_temperature_celsius > 70"),
          ),
          for: "1m",
          labels: {
            severity: "critical",
            category: "hardware",
          },
          annotations: {
            summary: "SSD temperature is critically high",
            description: escapePrometheusTemplate(
              "NVMe drive {{ $labels.model }} (serial {{ $labels.serial }}, {{ $labels.device }}) is at {{ $value }}°C and actively thermal-throttling I/O bandwidth, which degrades workload and CI performance. Inspect host cooling immediately and throttle heavy write workloads until temperatures drop.",
            ),
          },
        },

        // Raw-throughput alerts live in prometheus-resource-monitoring-rules
        // (HighDiskWriteActivity, SustainedDiskWriteActivity,
        // NodeDiskIOSaturation) and exclude the CI node, whose bursts are
        // expected. The endurance-normalized rules above cover every node,
        // including the CI node, because wear is what ends a drive.
      ],
    },
    getNvmeWriteBudgetRuleGroup(),
  ];
}
