import { beforeAll, describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { setupCharts } from "./setup-charts.ts";
import { transitionRendering } from "./release-configuration.ts";
import { APPLICATION_SOURCE_POLICY } from "./resources/argocd-application-admission.ts";
import {
  BASELINE_CHART_APPLICATIONS,
  BASELINE_CHART_NAMESPACE,
  CLUSTER_ADMISSION_CHART,
  CLUSTER_OBSERVABILITY_CHART,
  CLUSTER_PLATFORM_CHART,
  ROOT_CHART,
} from "./resources/cluster-baseline/charts.ts";

/**
 * The v2 cutover charts must render exactly the cluster objects the root chart
 * renders today, byte for byte, so that per-service Applications can take
 * over tracking without changing what the running system deploys. The
 * inventories below are explicit so that a resource added to, moved out of,
 * or renamed in either side fails here instead of drifting silently.
 */

const ManifestSchema = z
  .object({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: z
      .object({ name: z.string(), namespace: z.string().optional() })
      .loose(),
  })
  .loose();
type Manifest = z.infer<typeof ManifestSchema>;

function objectKey(manifest: Manifest): string {
  return `${manifest.apiVersion}/${manifest.kind}/${manifest.metadata.namespace ?? "-"}/${manifest.metadata.name}`;
}

/** Under transition rendering only Delivery writes Application sources. */
const sourceWriterPolicy: [name: string, flavor: "Mutating" | "Validating"][] =
  transitionRendering() ? [[APPLICATION_SOURCE_POLICY, "Validating"]] : [];

const admissionPolicies: readonly [
  name: string,
  flavor: "Mutating" | "Validating",
][] = [
  ["argocd-application-sync-options.sjer.red", "Mutating"],
  ["argocd-application-lifecycle.sjer.red", "Validating"],
  ["pvc-backup-included.sjer.red", "Mutating"],
  ["pvc-backup-excluded.sjer.red", "Mutating"],
  ["pvc-backup-policy.sjer.red", "Validating"],
  ["minecraft-tsmc-world-restoration.sjer.red", "Validating"],
  ["minecraft-tsmc-world-restoration-scale.sjer.red", "Validating"],
  ["minecraft-tsmc-world-restoration-delete.sjer.red", "Validating"],
  ["minecraft-tsmc-world-restoration-service-write.sjer.red", "Validating"],
  ["minecraft-tsmc-world-restoration-service-delete.sjer.red", "Validating"],
  ["woodpecker-workspace-seeds.sjer.red", "Mutating"],
  ["woodpecker-ci-pod-guard.sjer.red", "Validating"],
  ["woodpecker-ram-scratch.sjer.red", "Mutating"],
  ["woodpecker-ram-scratch-playwright-e2e.sjer.red", "Mutating"],
  ["woodpecker-ram-scratch-guard.sjer.red", "Validating"],
  ...sourceWriterPolicy,
];

const CLUSTER_ADMISSION_INVENTORY = admissionPolicies.flatMap(
  ([name, flavor]) => [
    `admissionregistration.k8s.io/v1/${flavor}AdmissionPolicy/argocd/${name}`,
    `admissionregistration.k8s.io/v1/${flavor}AdmissionPolicyBinding/argocd/${name}`,
  ],
);

const psaNamespaces = [
  "maintenance",
  "prometheus",
  "tailscale",
  "openebs",
  "intel-device-plugin-operator",
  "node-feature-discovery",
  "mc-router",
  "promtail",
  "pyroscope",
  "alloy",
  "alloy-gateway",
  "kueue-system",
  "node-tuning",
  "ops-restore-rehearsal",
  "ops-restore-rehearsal-incremental",
  "velero",
  "postgres-operator",
  "seaweedfs",
  "ddns",
];

const CLUSTER_PLATFORM_INVENTORY = [
  "storage.k8s.io/v1/StorageClass/argocd/zfs-ssd",
  "storage.k8s.io/v1/StorageClass/argocd/zfs-ssd-lz4",
  "storage.k8s.io/v1/StorageClass/argocd/ci-workspace",
  "storage.k8s.io/v1/StorageClass/argocd/zfs-hdd",
  "snapshot.storage.k8s.io/v1/VolumeSnapshotClass/argocd/host-zfs-snapshot",
  "scheduling.k8s.io/v1/PriorityClass/argocd/service-burst",
  "scheduling.k8s.io/v1/PriorityClass/argocd/infrastructure-critical",
  "scheduling.k8s.io/v1/PriorityClass/argocd/service-standard",
  "scheduling.k8s.io/v1/PriorityClass/argocd/batch-low",
  ...psaNamespaces.map((namespace) => `v1/Namespace/argocd/${namespace}`),
  "networking.k8s.io/v1/NetworkPolicy/ops-restore-rehearsal/ops-restore-rehearsal-isolate",
  "networking.k8s.io/v1/NetworkPolicy/ops-restore-rehearsal-incremental/ops-restore-rehearsal-incremental-isolate",
  "tailscale.com/v1alpha1/ProxyClass/argocd/standard",
  "tailscale.com/v1alpha1/ProxyClass/argocd/medium",
  "tailscale.com/v1alpha1/ProxyClass/argocd/heavy",
  "cert-manager.io/v1/Issuer/cert-manager/cert-manager-self-signed",
  "cert-manager.io/v1/Certificate/cert-manager/homelab-cluster-ca",
  "cert-manager.io/v1/ClusterIssuer/-/homelab-ca-issuer",
  "v1/ServiceAccount/node-tuning/cpu-power-cap",
  "apps/v1/DaemonSet/node-tuning/cpu-power-cap",
  ...["openebs", "prometheus", "minecraft-tsmc", "velero", "seaweedfs"].map(
    (namespace) =>
      `onepassword.com/v1/OnePasswordItem/${namespace}/dockerhub-pull-${namespace}`,
  ),
];

const prometheusRules: readonly [namespace: string, name: string][] = [
  ["woodpecker", "woodpecker"],
  ["buildkitd", "buildkitd"],
  ["prometheus", "alerting-control"],
  ["home", "homeassistant"],
  ["velero", "velero"],
  ["argocd", "argocd"],
  ["prometheus", "resource-monitoring"],
  ["prometheus", "zfs-monitoring"],
  ["prometheus", "smartctl"],
  ["prometheus", "nvme"],
  ["gickup", "gitckup"],
  ["media", "qbittorrent"],
  ["s3-static-sites", "static-sites"],
  ["prometheus", "service-probes"],
  ["prometheus", "alert-dashboard"],
  ["prometheus", "flipt"],
  ["prometheus", "r2-storage"],
  ["bugsink", "bugsink"],
  ["seaweedfs", "seaweedfs"],
  ["postal", "postal"],
  ["prometheus", "scout"],
  ["tasknotes", "tasknotes"],
  ["prometheus", "cluster-hygiene"],
  ["kube-system", "etcd-custom"],
  ["prometheus", "zfs-maintenance"],
  ["temporal", "temporal"],
  ["media", "streambot"],
  ["arcade", "arcade-goal"],
  ["prometheus", "llm"],
  ["prometheus", "ops-snapshot"],
  ["prometheus", "storm-brain"],
];

const nodeExporters = [
  "smartctl",
  "nvme-metrics",
  "zfs-snapshots",
  "zfs-zpool",
];

const grafanaDashboards = [
  "alert-dashboard",
  "ai-provider-dashboard",
  "buildkitd-dashboard",
  "ci-capacity-dashboard",
  "discord-plays-dashboard",
  "gitckup-dashboard",
  "scout-for-lol-dashboard",
  "scout-for-lol-durable-dashboard",
  "seaweedfs-backup-dashboard",
  "smartctl-dashboard",
  "static-site-probes-dashboard",
  "streambot-dashboard",
  "streambot-voice-dashboard",
  "tasknotes-dashboard",
  "temporal-dashboard",
  "velero-dashboard",
  "zfs-dashboard",
];

const CLUSTER_OBSERVABILITY_INVENTORY = [
  "v1/ConfigMap/prometheus/prometheus-auth-gateway-config",
  "v1/ConfigMap/prometheus/alertmanager-auth-gateway-config",
  "monitoring.coreos.com/v1/PodMonitor/woodpecker/woodpecker-server",
  "monitoring.coreos.com/v1/ServiceMonitor/buildkitd/buildkitd-service-monitor",
  "monitoring.coreos.com/v1/ServiceMonitor/kueue-system/kueue-controller-manager-metrics",
  "monitoring.coreos.com/v1/ServiceMonitor/prometheus/r2-exporter",
  ...prometheusRules.map(
    ([namespace, name]) =>
      `monitoring.coreos.com/v1/PrometheusRule/${namespace}/prometheus-${name}-rules`,
  ),
  ...nodeExporters.flatMap((exporter) => [
    `v1/ServiceAccount/prometheus/${exporter}-service-account`,
    `v1/ConfigMap/prometheus/${exporter === "smartctl" ? "smartmon" : exporter}-script`,
    `apps/v1/DaemonSet/prometheus/${exporter}-collector`,
  ]),
  "onepassword.com/v1/OnePasswordItem/prometheus/r2-exporter-cloudflare",
  "v1/ConfigMap/prometheus/r2-exporter-script",
  "apps/v1/Deployment/prometheus/r2-exporter",
  "v1/Service/prometheus/r2-exporter",
  "v1/ServiceAccount/prometheus/kubernetes-event-exporter",
  "rbac.authorization.k8s.io/v1/ClusterRole/argocd/kubernetes-event-exporter",
  "rbac.authorization.k8s.io/v1/ClusterRoleBinding/argocd/kubernetes-event-exporter",
  "v1/ConfigMap/prometheus/kubernetes-event-exporter-config",
  "apps/v1/Deployment/prometheus/kubernetes-event-exporter",
  "v1/ConfigMap/loki/loki-alert-rules",
  ...grafanaDashboards.map((name) => `v1/ConfigMap/prometheus/${name}`),
];

const INVENTORIES: Readonly<Record<string, readonly string[]>> = {
  [CLUSTER_ADMISSION_CHART]: CLUSTER_ADMISSION_INVENTORY,
  [CLUSTER_PLATFORM_CHART]: CLUSTER_PLATFORM_INVENTORY,
  [CLUSTER_OBSERVABILITY_CHART]: CLUSTER_OBSERVABILITY_INVENTORY,
};

let charts: Map<string, Manifest[]>;
beforeAll(async () => {
  const app = new App();
  await setupCharts(app);
  charts = new Map(
    app.charts.map((chart) => [
      chart.node.id,
      z.array(ManifestSchema).parse(chart.toJson()),
    ]),
  );
});

function chartObjects(chart: string): Manifest[] {
  const objects = charts.get(chart);
  if (objects === undefined) throw new Error(`Chart ${chart} was not rendered`);
  return objects;
}

describe("cluster baseline charts", () => {
  test("the switch names every baseline chart exactly once", () => {
    expect([...BASELINE_CHART_APPLICATIONS].sort()).toEqual(
      Object.keys(INVENTORIES).sort(),
    );
    expect(BASELINE_CHART_NAMESPACE).toBe("argocd");
    for (const chart of BASELINE_CHART_APPLICATIONS)
      expect(new Set(INVENTORIES[chart]).size).toBe(INVENTORIES[chart]?.length);
  });

  test.each(BASELINE_CHART_APPLICATIONS)(
    "%s renders exactly its inventory",
    (chart) => {
      expect(
        chartObjects(chart)
          .map((manifest) => objectKey(manifest))
          .sort(),
      ).toEqual([...(INVENTORIES[chart] ?? [])].sort());
    },
  );

  test.each(BASELINE_CHART_APPLICATIONS)(
    "%s renders every object byte-identically to the root chart",
    (chart) => {
      const root = new Map(
        chartObjects(ROOT_CHART).map((manifest) => [
          objectKey(manifest),
          manifest,
        ]),
      );
      for (const manifest of chartObjects(chart)) {
        const key = objectKey(manifest);
        expect(root.has(key), `${key} is not rendered by the root chart`).toBe(
          true,
        );
        expect(manifest, key).toStrictEqual(root.get(key));
      }
    },
  );

  test("baseline charts never render ArgoCD Applications", () => {
    for (const chart of BASELINE_CHART_APPLICATIONS)
      expect(
        chartObjects(chart).filter(
          (manifest) => manifest.kind === "Application",
        ),
      ).toEqual([]);
  });

  test("the inventories cover every root object they claim once", () => {
    const claimed = BASELINE_CHART_APPLICATIONS.flatMap(
      (chart) => INVENTORIES[chart] ?? [],
    );
    expect(new Set(claimed).size).toBe(claimed.length);
    const root = new Set(
      chartObjects(ROOT_CHART).map((manifest) => objectKey(manifest)),
    );
    expect(claimed.filter((key) => !root.has(key))).toEqual([]);
  });
});
