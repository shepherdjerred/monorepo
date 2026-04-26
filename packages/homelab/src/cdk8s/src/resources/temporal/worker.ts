import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  ServiceAccount,
} from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";

export type CreateTemporalWorkerDeploymentProps = {
  serverServiceName: string;
};

export function createTemporalWorkerDeployment(
  chart: Chart,
  props: CreateTemporalWorkerDeploymentProps,
) {
  const UID = 1000;
  const GID = 1000;

  const onePasswordItem = new OnePasswordItem(chart, "temporal-worker-1p", {
    spec: {
      itemPath: vaultItemPath("mjgnqqh37jxyzseqrddde2jgaq"),
    },
  });
  const secret = Secret.fromSecretName(
    chart,
    "temporal-worker-secret",
    onePasswordItem.name,
  );

  // ServiceAccount + RBAC for the golink-sync workflow, which lists Tailscale
  // Ingresses cluster-wide via @kubernetes/client-node's in-cluster config.
  const serviceAccount = new ServiceAccount(chart, "temporal-worker-sa", {
    metadata: { name: "temporal-worker" },
  });

  new KubeClusterRole(chart, "temporal-worker-ingress-reader", {
    metadata: { name: "temporal-worker-ingress-reader" },
    rules: [
      {
        apiGroups: ["networking.k8s.io"],
        resources: ["ingresses"],
        verbs: ["get", "list", "watch"],
      },
    ],
  });

  new KubeClusterRoleBinding(chart, "temporal-worker-ingress-reader-binding", {
    metadata: { name: "temporal-worker-ingress-reader" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "temporal-worker-ingress-reader",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  // Namespace-scoped RBAC for the ZFS maintenance workflow, which execs into
  // the zfs-zpool-collector DaemonSet pod in the prometheus namespace.
  new KubeRole(chart, "temporal-worker-zfs-exec", {
    metadata: { name: "temporal-worker-zfs-exec", namespace: "prometheus" },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods/exec"],
        verbs: ["create"],
      },
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-worker-zfs-exec-binding", {
    metadata: { name: "temporal-worker-zfs-exec", namespace: "prometheus" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-zfs-exec",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  // Namespace-scoped RBAC for the Bugsink housekeeping workflow, which execs
  // into the bugsink pod to run bugsink-manage maintenance commands.
  new KubeRole(chart, "temporal-worker-bugsink-exec", {
    metadata: { name: "temporal-worker-bugsink-exec", namespace: "bugsink" },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods/exec"],
        verbs: ["create"],
      },
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-worker-bugsink-exec-binding", {
    metadata: { name: "temporal-worker-bugsink-exec", namespace: "bugsink" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-bugsink-exec",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  const deployment = new Deployment(chart, "temporal-worker", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    serviceAccount,
    automountServiceAccountToken: true,
    securityContext: {
      fsGroup: GID,
    },
    podMetadata: {
      labels: {
        app: "temporal-worker",
      },
    },
  });

  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name: "temporal-worker",
      image: `ghcr.io/shepherdjerred/temporal-worker:${versions["shepherdjerred/temporal-worker"]}`,
      ports: [{ number: 9464, name: "metrics" }],
      securityContext: {
        user: UID,
        group: GID,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          request: Cpu.millis(200),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.gibibytes(1),
        },
      },
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        // Make the cluster CA globally trusted. @kubernetes/client-node hands
        // its `ca` to node-fetch via an https.Agent; Bun's node-fetch polyfill
        // doesn't reliably honor per-agent CA bundles, which surfaced as
        // "unable to verify the first certificate" from listTailscaleIngresses.
        // NODE_EXTRA_CA_CERTS is read once at process startup (by both Node
        // and Bun) and appended to the default root set, so every TLS call
        // — fetch, https, undici — trusts it.
        NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
          "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
        ),
        // Home Assistant
        HA_URL: EnvValue.fromSecretValue({
          secret,
          key: "HA_URL",
        }),
        HA_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "HA_TOKEN",
        }),
        // S3 / SeaweedFS (for fetcher)
        S3_BUCKET_NAME: EnvValue.fromSecretValue({
          secret,
          key: "S3_BUCKET_NAME",
        }),
        S3_ENDPOINT: EnvValue.fromSecretValue({
          secret,
          key: "S3_ENDPOINT",
        }),
        S3_KEY: EnvValue.fromValue("data/manifest.json"),
        S3_REGION: EnvValue.fromValue("us-east-1"),
        S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret,
          key: "AWS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret,
          key: "AWS_SECRET_ACCESS_KEY",
        }),
        // GitHub
        GH_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "GH_TOKEN",
        }),
        SENTRY_DSN: EnvValue.fromSecretValue(
          {
            secret,
            key: "SENTRY_DSN",
          },
          { optional: true },
        ),
        // OpenAI
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "OPENAI_API_KEY",
        }),
        // Postal email
        POSTAL_HOST: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_HOST",
        }),
        POSTAL_HOST_HEADER: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_HOST_HEADER",
        }),
        POSTAL_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "POSTAL_API_KEY",
        }),
        RECIPIENT_EMAIL: EnvValue.fromSecretValue({
          secret,
          key: "RECIPIENT_EMAIL",
        }),
        SENDER_EMAIL: EnvValue.fromValue("updates@homelab.local"),
      },
    }),
  );

  void container;

  new Service(chart, "temporal-worker-metrics-service", {
    selector: deployment,
    metadata: {
      labels: { app: "temporal-worker-metrics" },
    },
    ports: [{ port: 9464, name: "metrics" }],
  });

  createServiceMonitor(chart, {
    name: "temporal-worker-metrics",
    matchLabels: { app: "temporal-worker-metrics" },
  });

  return { deployment };
}
