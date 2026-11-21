import { describe, expect, it } from "vitest";
import { runPromtoolFixture } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/platform/promtool-fixture.ts";
import { getVeleroRuleGroups } from "./velero.ts";

function alertExpression(name: string): string {
  const rule = getVeleroRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .find((candidate) => candidate.alert === name);
  if (rule === undefined) throw new Error(`missing alert ${name}`);
  return String(rule.expr.value);
}

describe("ZFS dataset snapshot count alert", () => {
  it("counts Velero-managed snapshots without charging manual recovery points", () => {
    const expression = alertExpression("ZFSDatasetSnapshotCountExcessive");

    expect(expression).toContain("velero_managed_snapshot_count");
    expect(expression).not.toContain("zfs_dataset_snapshot_count");
  });
});

describe("Velero backup duration alert", () => {
  it("counts each backup over 60 minutes with namespace label for InfoInhibitor", () => {
    const rule = getVeleroRuleGroups()
      .flatMap((group) => group.rules ?? [])
      .find((candidate) => candidate.alert === "VeleroBackupDurationExcessive");
    if (rule === undefined)
      throw new Error("missing VeleroBackupDurationExcessive");
    const expression = String(rule.expr.value);

    expect(expression).toContain(
      'velero_backup_duration_seconds_bucket{le="3600.0"}',
    );
    expect(expression).not.toContain('le="1800.0"');
    expect(expression).toContain("velero_backup_duration_seconds_count");
    expect(expression).not.toContain("velero_backup_duration_seconds_sum");
    expect(expression).not.toMatch(/velero_backup_duration_seconds\)/u);
    expect(rule.labels).toEqual({ severity: "info", namespace: "velero" });
    expect(rule.annotations?.["message"]).toBeUndefined();
    expect(rule.annotations?.["description"]).toContain('printf "%.0f"');
    expect(rule.annotations?.["description"]).toContain(
      "longer than 60 minutes",
    );
  });
});

const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

/**
 * A Bound claim's ZFS usage and Kubernetes ownership series. The label series
 * carries `label_velero_io_backup` only when the claim has the label.
 * `instances` models a second exporter replica during a rollout.
 */
function claim(input: {
  namespace: string;
  name: string;
  bytes: number;
  backup?: "enabled" | "disabled";
  instances?: readonly string[];
}) {
  const key = `namespace="${input.namespace}",persistentvolumeclaim="${input.name}"`;
  const volume = `pvc-${input.namespace}-${input.name}`;
  const backupLabel =
    input.backup === undefined
      ? ""
      : `,label_velero_io_backup="${input.backup}"`;
  return [
    {
      series: `zfs_dataset_used_bytes{dataset_name="zfspv-pool-nvme/${volume}"}`,
      values: String(input.bytes),
    },
    {
      series: `kube_persistentvolumeclaim_info{${key},volumename="${volume}"}`,
      values: "1",
    },
    {
      series: `kube_persistentvolumeclaim_status_phase{${key},phase="Bound"}`,
      values: "1",
    },
    ...(input.instances ?? ["ksm-a"]).map((instance) => ({
      series: `kube_persistentvolumeclaim_labels{${key},instance="${instance}"${backupLabel}}`,
      values: "1",
    })),
  ];
}

describe("Velero PVC size alerts", () => {
  it("count only claims the Velero schedules select", async () => {
    // The disabled cache and the unlabelled claim would push the old
    // all-claims sums over both thresholds; neither is ever backed up.
    const series = [
      ...claim({
        namespace: "media",
        name: "library",
        bytes: 1.5 * TIB,
        backup: "enabled",
        // A duplicated label series must not double-count the claim.
        instances: ["ksm-a", "ksm-b"],
      }),
      ...claim({
        namespace: "media",
        name: "transcode-cache",
        bytes: 1 * TIB,
        backup: "disabled",
      }),
      ...claim({
        namespace: "woodpecker-ci",
        name: "woodpecker-bun-cache",
        bytes: 600 * GIB,
        backup: "disabled",
      }),
      ...claim({ namespace: "scratch", name: "unlabelled", bytes: 600 * GIB }),
    ];
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          input_series: series,
          promql_expr_test: [
            {
              expr: alertExpression("VeleroNamespacePVCSizeExcessive"),
              eval_time: "0m",
              exp_samples: [
                { labels: '{namespace="media"}', value: 1.5 * TIB },
              ],
            },
            {
              expr: alertExpression("VeleroTotalPVCSizeExcessive"),
              eval_time: "0m",
              exp_samples: [],
            },
          ],
        },
      ],
    });
  });

  it("still fires when backed-up claims alone exceed the thresholds", async () => {
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          input_series: [
            ...claim({
              namespace: "media",
              name: "library",
              bytes: 2.5 * TIB,
              backup: "enabled",
            }),
          ],
          promql_expr_test: [
            {
              expr: alertExpression("VeleroNamespacePVCSizeExcessive"),
              eval_time: "0m",
              exp_samples: [
                { labels: '{namespace="media"}', value: 2.5 * TIB },
              ],
            },
            {
              expr: alertExpression("VeleroTotalPVCSizeExcessive"),
              eval_time: "0m",
              exp_samples: [{ labels: "{}", value: 2.5 * TIB }],
            },
          ],
        },
      ],
    });
  });
});
