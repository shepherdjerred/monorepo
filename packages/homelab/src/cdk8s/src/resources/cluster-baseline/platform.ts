import type { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createStorageClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { createPriorityClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { createCpuPowerCap } from "@shepherdjerred/homelab/cdk8s/src/resources/cpu-power-cap.ts";
import { createClusterCertificateAuthority } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/cert-manager.ts";
import { createTailscaleProxyClasses } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/tailscale.ts";
import { createOpenEBSNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/openebs.ts";
import { createNfdNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/nfd.ts";
import { createIntelDevicePluginOperatorNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/intel-device-plugin-operator.ts";
import { createKueueNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/kueue.ts";
import { createPostgresOperatorNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/postgres-operator.ts";
import { createVeleroNamespaces } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/velero.ts";
import { createSeaweedfsNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts";
import { createPromtailNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/promtail.ts";
import { createAlloyNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alloy.ts";
import { createAlloyGatewayNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alloy-gateway.ts";
import { createPyroscopeNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/pyroscope.ts";
import { createDdnsNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/ddns.ts";
import { createMcRouterNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/mc-router.ts";

/** Pod-Security-labelled namespaces the root declares directly. */
export function createBaselineNamespaces(chart: Chart): void {
  new Namespace(chart, `maintenance-namespace`, {
    metadata: {
      name: `maintenance`,
      labels: {
        "pod-security.kubernetes.io/audit": "restricted",
      },
    },
  });

  new Namespace(chart, "prometheus-namespace", {
    metadata: {
      name: "prometheus",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  // The Tailscale operator creates privileged kernel-mode proxy pods here.
  // Without an explicit label, the cluster's baseline default rejects new proxies.
  new Namespace(chart, "tailscale-namespace", {
    metadata: {
      name: "tailscale",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });
}

/**
 * Enforces Intel stock package power limits (PL1 125 W / PL2 253 W). ASUS
 * firmware defaults PL1 to unlimited, which drove sustained 100 °C TJMax and
 * overheated the adjacent M.2 slots before the AIO cooler was installed
 * (2026-05-26). The original emergency cap was 95/140; raised to stock once
 * the AIO + per-drive NVMe cooling were verified.
 * See the original investigation.
 */
export function createCpuPowerCapGuard(chart: Chart): void {
  createCpuPowerCap(chart, { pl1Watts: 125, pl2Watts: 253 });
}

/**
 * Cluster-scoped platform baseline: storage and priority classes, the cluster
 * CA, Tailscale proxy classes, every namespace the root declares ahead of its
 * Application, and the node power cap. Kueue's queues deploy with Kueue
 * (`kueue-queues`). The namespace pull-secret mirrors are added by
 * `prepareDockerHubPullSecrets`.
 */
export function createClusterPlatform(chart: Chart): void {
  createStorageClasses(chart);
  createPriorityClasses(chart);
  createBaselineNamespaces(chart);
  createOpenEBSNamespace(chart);
  createTailscaleProxyClasses(chart);
  createIntelDevicePluginOperatorNamespace(chart);
  createClusterCertificateAuthority(chart);
  createNfdNamespace(chart);
  createMcRouterNamespace(chart);
  createPromtailNamespace(chart);
  createPyroscopeNamespace(chart);
  createAlloyNamespace(chart);
  createAlloyGatewayNamespace(chart);
  createKueueNamespace(chart);
  createCpuPowerCapGuard(chart);
  createVeleroNamespaces(chart);
  createPostgresOperatorNamespace(chart);
  createSeaweedfsNamespace(chart);
  createDdnsNamespace(chart);
}
