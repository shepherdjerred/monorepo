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
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

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
      // :9464 = Temporal SDK's built-in Prometheus bridge (workflow_completed,
      //        activity_task_fail, etc. — see installRuntime in worker.ts)
      // :9465 = application Prometheus registry (docs_groom_*, default Bun
      //        process metrics — see observability/metrics.ts)
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
      ],
      securityContext: {
        user: UID,
        group: GID,
        readOnlyRootFilesystem: false,
      },
      // Bumped from 200m/500m and 256Mi/1Gi to give headroom for in-process
      // claude -p invocations from the docs-groom workflow.
      resources: {
        cpu: {
          request: Cpu.millis(500),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        ENVIRONMENT: EnvValue.fromValue("production"),
        // OpenTelemetry tracing → Tempo. initializeTracing() in worker.ts
        // gates on TELEMETRY_ENABLED.
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-worker"),
        // Anthropic Claude (used by the docs-groom workflow).
        ANTHROPIC_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "ANTHROPIC_API_KEY",
        }),
        // Git identity for any workflow that runs `git commit` (docs-groom).
        GIT_AUTHOR_NAME: EnvValue.fromValue("temporal-worker[bot]"),
        GIT_AUTHOR_EMAIL: EnvValue.fromValue("temporal-worker@homelab.local"),
        GIT_COMMITTER_NAME: EnvValue.fromValue("temporal-worker[bot]"),
        GIT_COMMITTER_EMAIL: EnvValue.fromValue(
          "temporal-worker@homelab.local",
        ),
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
        // Bugsink (Sentry-compatible) error tracking. Read by initSentry()
        // in worker.ts; when unset, Sentry init is a no-op.
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

  // Service + ServiceMonitor for the Temporal SDK's built-in Prometheus
  // bridge on :9464.
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

  // Service + ServiceMonitor for the application Prometheus registry on
  // :9465 (started by observability/metrics.ts in the worker). Separate
  // from the SDK bridge so app-level handles can evolve independently.
  new Service(chart, "temporal-worker-app-metrics-service", {
    metadata: {
      name: "temporal-worker-app-metrics",
      labels: { app: "temporal-worker-app-metrics" },
    },
    selector: deployment,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });

  createServiceMonitor(chart, {
    name: "temporal-worker-app-metrics",
    port: "app-metrics",
    interval: "30s",
    matchLabels: { app: "temporal-worker-app-metrics" },
  });

  return { deployment };
}
