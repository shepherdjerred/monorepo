import { describe, it } from "vitest";
import { getZfsPvcRuleGroup } from "./resource-monitoring-zfs.ts";
import { runPromtoolFixture } from "./promtool-fixture.ts";

function zfsPvcAlert(alert: string): string {
  const rule = (getZfsPvcRuleGroup().rules ?? []).find(
    (entry) => entry.alert === alert,
  );
  if (rule === undefined) throw new Error(`Missing ${alert}`);
  return String(rule.expr.value);
}

const LIVE_VOLUME = "pvc-6f1c";
const ORPHAN_VOLUME = "pvc-9a0e";
const LIVE_NAMESPACE = "minecraft-tsmc";
const RESTORE_NAMESPACE = "minecraft-tsmc-restore-3e5117f2";
const CLAIM = "datadir-minecraft-tsmc-0";

function dataset(volume: string, used: number, available: number) {
  const name = `zfspv-pool-nvme/${volume}`;
  return [
    {
      series: `zfs_dataset_used_bytes{dataset_name="${name}"}`,
      values: String(used),
    },
    {
      series: `zfs_dataset_available_bytes{dataset_name="${name}"}`,
      values: String(available),
    },
  ];
}

// A claim as kube-state-metrics reports it: its info series and one phase
// series per phase. `instance` models a second exporter during a rollout.
function claim(input: {
  namespace: string;
  volume: string;
  phase: "Bound" | "Pending";
  instance?: string;
}) {
  const instance = input.instance ?? "ksm-a";
  const key = `namespace="${input.namespace}",persistentvolumeclaim="${CLAIM}",instance="${instance}"`;
  return [
    {
      series: `kube_persistentvolumeclaim_info{${key},storageclass="zfs-ssd-lz4",volumename="${input.volume}"}`,
      values: "1",
    },
    ...(["Bound", "Pending", "Lost"] as const).map((phase) => ({
      series: `kube_persistentvolumeclaim_status_phase{${key},phase="${phase}"}`,
      values: phase === input.phase ? "1" : "0",
    })),
  ];
}

function alertLabels(volume: string, namespace: string): string {
  return `{dataset_name="zfspv-pool-nvme/${volume}",volumename="${volume}",namespace="${namespace}",persistentvolumeclaim="${CLAIM}"}`;
}

describe("ZfsPVCStorageHigh", () => {
  it("attributes a dataset to its Bound claim, not to a restore claim that names the same volume", async () => {
    // A Velero restore into its own namespace recreates the claim with the
    // live PV's volumeName, so two claims share one volumename while only the
    // live one is Bound. The orphan volume has only a Pending claim.
    const series = [
      ...dataset(LIVE_VOLUME, 80, 20),
      ...dataset(ORPHAN_VOLUME, 95, 5),
      ...claim({
        namespace: LIVE_NAMESPACE,
        volume: LIVE_VOLUME,
        phase: "Bound",
      }),
      ...claim({
        namespace: RESTORE_NAMESPACE,
        volume: LIVE_VOLUME,
        phase: "Pending",
      }),
      ...claim({
        namespace: RESTORE_NAMESPACE,
        volume: ORPHAN_VOLUME,
        phase: "Pending",
      }),
    ];
    // The same cluster while kube-state-metrics rolls: every series of the
    // live claim is reported twice.
    const rolling = [
      ...series,
      ...claim({
        namespace: LIVE_NAMESPACE,
        volume: LIVE_VOLUME,
        phase: "Bound",
        instance: "ksm-b",
      }),
    ];
    const expected = [
      { labels: alertLabels(LIVE_VOLUME, LIVE_NAMESPACE), value: 0.8 },
    ];
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [series, rolling].map((input) => ({
        interval: "1m",
        input_series: input,
        promql_expr_test: [
          {
            expr: zfsPvcAlert("ZfsPVCStorageHigh"),
            eval_time: "0m",
            exp_samples: expected,
          },
          {
            expr: zfsPvcAlert("ZfsPVCStorageCritical"),
            eval_time: "0m",
            exp_samples: [],
          },
        ],
      })),
    });
  });
});
