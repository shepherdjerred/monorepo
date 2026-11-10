import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { SATA_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
/** Objects the root renders beside the Application; the `chartmuseum-companion` companion chart renders the same objects under transition rendering. */
export function createChartMuseumResources(chart: Chart): OnePasswordItem {
  createIngress(chart, "chartmuseum-ingress", {
    namespace: "chartmuseum",
    service: "chartmuseum",
    port: 8080,
    hosts: ["chartmuseum"],
    proxyClass: "heavy",
  });

  createCloudflareTunnelBinding(chart, "chartmuseum-cf-tunnel", {
    serviceName: "chartmuseum",
    subdomain: "chartmuseum",
    namespace: "chartmuseum",
    port: 8080,
  });

  return onePasswordSecret(
    chart,
    "chartmuseum-admin-password",
    "wwoism5fsvmbisv4ef47yxqy2i",
    { name: "chartmuseum-basic-auth", namespace: "chartmuseum" },
  );
}

export function createChartMuseumApp(chart: Chart) {
  const basicAuth = createChartMuseumResources(chart);

  // Its data lives on a ReadWriteOnce ZFS volume, so a surge pod can never
  // mount it while the old pod holds it, and the chart's default RollingUpdate
  // (25% surge, 25% unavailable: 1 and 0 for one replica) deadlocks every
  // rollout. Stopping the old pod first is the only order that works. Recreate
  // cannot be set on the existing Deployment: it keeps API-defaulted
  // rollingUpdate params that Recreate forbids. The chart passes `strategy`
  // through verbatim, but its values file declares only `type`, so the object
  // is declared apart from the values literal.
  const strategy = {
    type: "RollingUpdate",
    rollingUpdate: { maxSurge: 0, maxUnavailable: 1 },
  };

  const chartMuseumValues: HelmValuesForChart<"chartmuseum"> = {
    strategy,
    // The chart declares no requests, which left chartmuseum BestEffort: the
    // first pod evicted under memory pressure. Over 14d to 2026-11-08 its p95
    // was 0.18 CPU and 0.61Gi RSS (max 0.94Gi).
    resources: {
      requests: {
        cpu: "200m",
        memory: "640Mi",
      },
    },
    persistence: {
      enabled: true,
      storageClass: SATA_STORAGE_CLASS,
      size: Size.gibibytes(8).asString(),
    },
    env: {
      open: {
        DISABLE_API: false,
        AUTH_ANONYMOUS_GET: true,
      },
      existingSecret: basicAuth.name,
      existingSecretMappings: {
        BASIC_AUTH_USER: "username",
        BASIC_AUTH_PASS: "password",
      },
    },
  };

  return new Application(chart, "chartmuseum-app", {
    metadata: {
      name: "chartmuseum",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("chartmuseum"),
      source: {
        repoUrl: "https://chartmuseum.github.io/charts",
        targetRevision: versions.chartmuseum,
        chart: "chartmuseum",
        helm: {
          valuesObject: chartMuseumValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "chartmuseum",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
