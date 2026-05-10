import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  EnvValue,
  Probe,
  Secret,
  Service,
  ServiceAccount,
} from "cdk8s-plus-31";
import {
  IntOrString,
  KubeClusterRole,
  KubeClusterRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createTrmnlDashboardDeployment(chart: Chart) {
  const onePasswordItem = new OnePasswordItem(chart, "trmnl-dashboard-1p", {
    spec: {
      itemPath: vaultItemPath("trmnl-dashboard-credentials"),
    },
  });
  const secret = Secret.fromSecretName(
    chart,
    "trmnl-dashboard-secret",
    onePasswordItem.name,
  );

  const serviceAccount = new ServiceAccount(chart, "trmnl-dashboard-sa", {
    metadata: { name: "trmnl-dashboard" },
  });

  new KubeClusterRole(chart, "trmnl-dashboard-reader", {
    metadata: { name: "trmnl-dashboard-reader" },
    rules: [
      {
        apiGroups: [""],
        resources: ["nodes", "pods"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeClusterRoleBinding(chart, "trmnl-dashboard-reader-binding", {
    metadata: { name: "trmnl-dashboard-reader" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "trmnl-dashboard-reader",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "trmnl-dashboard",
      },
    ],
  });

  const deployment = new Deployment(chart, "trmnl-dashboard", {
    replicas: 1,
    serviceAccount,
    automountServiceAccountToken: true,
    podMetadata: {
      labels: { app: "trmnl-dashboard" },
    },
  });

  deployment.addContainer(
    withCommonProps({
      name: "trmnl-dashboard",
      image: `ghcr.io/shepherdjerred/trmnl-dashboard:${versions["shepherdjerred/trmnl-dashboard"]}`,
      ports: [{ number: 3000, name: "http" }],
      envVariables: {
        PORT: EnvValue.fromValue("3000"),
        TRMNL_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "TRMNL_API_KEY",
        }),
        HA_URL: EnvValue.fromSecretValue({
          secret,
          key: "HA_URL",
        }),
        HA_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "HA_TOKEN",
        }),
        HA_PRESENCE_ENTITIES: EnvValue.fromSecretValue({
          secret,
          key: "HA_PRESENCE_ENTITIES",
        }),
        HA_SECURITY_ENTITIES: EnvValue.fromSecretValue({
          secret,
          key: "HA_SECURITY_ENTITIES",
        }),
        HA_CLIMATE_ENTITIES: EnvValue.fromSecretValue({
          secret,
          key: "HA_CLIMATE_ENTITIES",
        }),
        BUGSINK_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "BUGSINK_TOKEN",
        }),
        PAGERDUTY_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "PAGERDUTY_TOKEN",
        }),
      },
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(250),
        },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(384),
        },
      },
      liveness: Probe.fromHttpGet("/livez", {
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/healthz", {
        port: 3000,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
    }),
  );

  setRevisionHistoryLimit(deployment, 5);

  const service = new Service(chart, "trmnl-dashboard-service", {
    selector: deployment,
    ports: [{ port: 3000, name: "http" }],
  });

  createCloudflareTunnelBinding(chart, "trmnl-dashboard-cf-tunnel", {
    serviceName: service.name,
    fqdn: "trmnl.sjer.red",
  });

  return { deployment, service };
}

export const trmnlDashboardPorts = [53, 80, 443, 8000, 8123, 9090, 9093].map(
  (port) => ({
    port: IntOrString.fromNumber(port),
    protocol: port === 53 ? "UDP" : "TCP",
  }),
);
