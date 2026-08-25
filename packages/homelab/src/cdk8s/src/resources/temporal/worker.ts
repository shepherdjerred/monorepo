import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  createTemporalWorkerAuditRbac,
  createTemporalWorkerTasknotesCanaryRbac,
} from "./audit-rbac.ts";
import { createTemporalAgentWorker } from "./agent-worker.ts";
import { createTemporalWorkerCrdReaderRbac } from "./crd-rbac.ts";
import { glitterContextEnv, glitterCorpusEnv } from "./glitter-corpus-env.ts";
import { createTemporalGlitterWorkers } from "./glitter-worker.ts";
import { createTemporalIngressWorkers } from "./ingress-workers.ts";
import { createTemporalLegacyWorkerMetrics } from "./legacy-worker-metrics.ts";
import {
  homelabAuditEnv,
  legacyWorkerEnvironment,
} from "./legacy-worker-env.ts";
import { createTemporalOperationsWorkers } from "./operations-workers.ts";
import { temporalWorkerHealthProbes } from "./worker-health.ts";
import { FRESHRSS_DESIRED_JSON } from "@shepherdjerred/homelab/cdk8s/src/resources/freshrss-config.ts";
import {
  createTemporalWorkerMaintenanceRbac,
  createTemporalWorkerIngressReaderRbac,
  createTemporalWorkerServiceAccount,
} from "./worker-rbac.ts";

export type CreateTemporalWorkerDeploymentProps = {
  serverServiceName: string;
};

export function createTemporalWorkerDeployment(
  chart: Chart,
  props: CreateTemporalWorkerDeploymentProps,
) {
  const UID = 1000;

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
  const starlightBotItem = new OnePasswordItem(
    chart,
    "temporal-starlight-bot-1p",
    {
      spec: {
        itemPath: vaultItemPath("cmp6si6n5syhr4smxew3qfcmfi"),
      },
    },
  );
  const starlightBotSecret = Secret.fromSecretName(
    chart,
    "temporal-starlight-bot-secret",
    starlightBotItem.name,
  );
  const freshRssCredentialItem = new OnePasswordItem(
    chart,
    "temporal-freshrss-sync-1p",
    {
      metadata: { name: "temporal-freshrss-sync" },
      spec: { itemPath: vaultItemPath("freshrss-sync") },
    },
  );
  const scoutWeeklyParlayItem = new OnePasswordItem(
    chart,
    "temporal-scout-weekly-parlay-control-1p",
    {
      metadata: { name: "temporal-scout-weekly-parlay-control" },
      spec: { itemPath: vaultItemPath("scout-weekly-parlay-control") },
    },
  );
  const scoutWeeklyParlaySecret = Secret.fromSecretName(
    chart,
    "temporal-scout-weekly-parlay-control-secret",
    scoutWeeklyParlayItem.name,
  );
  const freshRssCredential = Secret.fromSecretName(
    chart,
    "temporal-freshrss-sync-secret",
    freshRssCredentialItem.name,
  );
  const freshRssManifest = new ConfigMap(chart, "temporal-freshrss-manifest", {
    metadata: { name: "temporal-freshrss-manifest" },
    data: { "desired.json": FRESHRSS_DESIRED_JSON },
  });

  const serviceAccount = createTemporalWorkerServiceAccount(chart);
  const infraServiceAccount = createTemporalWorkerServiceAccount(chart, {
    constructId: "temporal-infra-worker-sa",
    name: "temporal-infra-worker",
  });
  const agentServiceAccount = new ServiceAccount(
    chart,
    "temporal-agent-worker-sa",
    {
      metadata: { name: "temporal-agent-worker" },
    },
  );

  createTemporalWorkerIngressReaderRbac(chart, [
    serviceAccount,
    infraServiceAccount,
  ]);
  createTemporalWorkerMaintenanceRbac(chart, [
    serviceAccount,
    infraServiceAccount,
  ]);

  // Cluster-wide read-only RBAC for deterministic collectors and generic
  // report-only investigations. Only the core worker receives the separate
  // TaskNotes exec role; the agent worker cannot exec into any pod.
  createTemporalWorkerAuditRbac(chart, [
    serviceAccount,
    infraServiceAccount,
    agentServiceAccount,
  ]);
  createTemporalWorkerTasknotesCanaryRbac(chart, [
    serviceAccount,
    infraServiceAccount,
  ]);

  // Read-only CRD access for homelab-crd-imports-daily. See ./crd-rbac.ts.
  createTemporalWorkerCrdReaderRbac(chart, [
    serviceAccount,
    infraServiceAccount,
  ]);

  const deployment = new Deployment(chart, "temporal-worker", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    serviceAccount,
    automountServiceAccountToken: true,
    securityContext: {
      fsGroup: UID,
    },
    podMetadata: {
      labels: {
        app: "temporal-worker",
        component: "legacy-worker",
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
      // :9465 = application Prometheus registry (pr_*, default Bun process
      //        metrics — see observability/metrics.ts)
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
      ],
      securityContext: {
        user: UID,
        group: UID,
        readOnlyRootFilesystem: false,
      },
      // Sized for in-process claude -p invocations. The pr-agent activity
      // (review + summary) runs for a few minutes; the homelab-audit-daily
      // workflow runs ~25 min and shells out to kubectl / talosctl / curl
      // alongside claude. 30d working-set peak hit 3.9Gi against the old 4Gi
      // limit (near-OOM), so the request reflects real usage and the limit
      // has slack above the observed peak.
      resources: {
        cpu: {
          request: Cpu.millis(500),
          limit: Cpu.millis(1500),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(6),
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: legacyWorkerEnvironment({
        serverServiceName: props.serverServiceName,
        secret,
        starlightBotSecret,
        scoutWeeklyParlaySecret,
      }),
    }),
  );

  // Bun resolves its scratch directory to /tmp at startup and bails with
  // `bun is unable to write files to tempdir: AccessDenied` if the path
  // isn't writable for UID 1000. Activities also stage real work under
  // /tmp (deps-summary clones, the kubectl / gh / github-mcp-server
  // installers in image.ts). A node-disk-backed emptyDir keeps that out
  // of the 2 GiB pod memory budget.
  const tmpVolume = Volume.fromEmptyDir(chart, "temporal-worker-tmp", "tmp");
  container.mount("/tmp", tmpVolume);
  const freshRssManifestVolume = Volume.fromConfigMap(
    chart,
    "temporal-freshrss-manifest-volume",
    freshRssManifest,
    { items: { "desired.json": { path: "desired.json" } } },
  );
  const freshRssCredentialVolume = Volume.fromSecret(
    chart,
    "temporal-freshrss-sync-secret-volume",
    freshRssCredential,
    { items: { password: { path: "password" } } },
  );
  container.mount("/etc/freshrss", freshRssManifestVolume, {
    readOnly: true,
  });
  container.mount("/run/secrets/freshrss", freshRssCredentialVolume, {
    readOnly: true,
  });

  const agentDeployment = createTemporalAgentWorker(chart, {
    serviceAccount: agentServiceAccount,
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("agent"),
      AGENT_PROVIDER_UID: EnvValue.fromValue("1001"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: EnvValue.fromValue("1"),
      DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
      TELEMETRY_ENABLED: EnvValue.fromValue("true"),
      OTLP_ENDPOINT: EnvValue.fromValue(
        "http://tempo.tempo.svc.cluster.local:4318",
      ),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-agent-worker"),
      NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
        "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      ),
      CLAUDE_CODE_OAUTH_TOKEN: EnvValue.fromSecretValue({
        secret,
        key: "CLAUDE_CODE_OAUTH_TOKEN",
      }),
      // Codex SDK subscription token. The agent worker holds one credential
      // per provider and no direct-provider inference key.
      CODEX_ACCESS_TOKEN: EnvValue.fromSecretValue({
        secret,
        key: "CODEX_ACCESS_TOKEN",
      }),
      PROMETHEUS_URL: EnvValue.fromValue(
        "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
      ),
      ALERT_DASHBOARD_URL: EnvValue.fromValue(
        "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
      ),
    },
  });

  const { gatewayDeployment, homeDeployment, reportsDeployment } =
    createTemporalIngressWorkers(chart, {
      serverServiceName: props.serverServiceName,
      secret,
    });

  const glitterCommonEnv = {
    TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
    TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
    ENVIRONMENT: EnvValue.fromValue("production"),
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    OTLP_ENDPOINT: EnvValue.fromValue(
      "http://tempo.tempo.svc.cluster.local:4318",
    ),
    SENTRY_DSN: EnvValue.fromSecretValue({ secret, key: "SENTRY_DSN" }),
  };
  const { corpusDeployment, contextDeployment } = createTemporalGlitterWorkers(
    chart,
    {
      corpusEnvVariables: {
        ...glitterCommonEnv,
        TEMPORAL_WORKER_ROLE: EnvValue.fromValue("glitter-corpus"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue(
          "temporal-glitter-corpus-worker",
        ),
        ...glitterCorpusEnv(secret, starlightBotSecret),
      },
      contextEnvVariables: {
        ...glitterCommonEnv,
        TEMPORAL_WORKER_ROLE: EnvValue.fromValue("glitter-context"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue(
          "temporal-glitter-context-worker",
        ),
        OPENROUTER_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "OPENROUTER_API_KEY",
        }),
        GITHUB_APP_ID: EnvValue.fromSecretValue({
          secret,
          key: "GITHUB_APP_ID",
        }),
        GITHUB_APP_INSTALLATION_ID: EnvValue.fromSecretValue({
          secret,
          key: "GITHUB_APP_INSTALLATION_ID",
        }),
        GITHUB_APP_PRIVATE_KEY: EnvValue.fromSecretValue({
          secret,
          key: "GITHUB_APP_PRIVATE_KEY",
        }),
        GIT_AUTHOR_NAME: EnvValue.fromValue("temporal-worker[bot]"),
        GIT_AUTHOR_EMAIL: EnvValue.fromValue("temporal-worker@homelab.local"),
        GIT_COMMITTER_NAME: EnvValue.fromValue("temporal-worker[bot]"),
        GIT_COMMITTER_EMAIL: EnvValue.fromValue(
          "temporal-worker@homelab.local",
        ),
        ...glitterContextEnv(secret),
      },
    },
  );

  // Project the talosconfig YAML from 1Password into a file at
  // /etc/talos/config. The homelab-audit-daily workflow's §1 commands
  // (`talosctl health`, `talosctl get members`, `talosctl dmesg`) need it —
  // kubectl-derived signal covers Ready/kernel but misses ZFS / OOM event
  // detail. The 1P field is `TALOSCONFIG_YAML` (one string holding the full
  // YAML). Required — the secret must carry this key (a missing TALOSCONFIG_YAML
  // crash-loops the pod rather than silently dropping talosctl coverage).
  const talosConfigVolume = Volume.fromSecret(
    chart,
    "temporal-worker-talosconfig",
    secret,
    {
      name: "talosconfig",
      items: { TALOSCONFIG_YAML: { path: "config" } },
      defaultMode: 0o400,
    },
  );
  container.mount("/etc/talos", talosConfigVolume, { readOnly: true });

  const { infraDeployment, repoDeployment, scoutDeployment } =
    createTemporalOperationsWorkers(chart, {
      serverServiceName: props.serverServiceName,
      secret,
      scoutWeeklyParlaySecret,
      infraServiceAccount,
      homelabAuditEnvironment: homelabAuditEnv(secret),
      talosConfigVolume,
      freshRssManifestVolume,
      freshRssCredentialVolume,
    });

  createTemporalLegacyWorkerMetrics(chart);

  return {
    deployment,
    agentDeployment,
    gatewayDeployment,
    homeDeployment,
    reportsDeployment,
    infraDeployment,
    repoDeployment,
    scoutDeployment,
    glitterCorpusDeployment: corpusDeployment,
    glitterContextDeployment: contextDeployment,
  };
}
