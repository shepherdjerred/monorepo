import type { Chart } from "cdk8s";
import {
  ConfigMap,
  EnvValue,
  Secret,
  ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  createTemporalWorkerAuditRbac,
  createTemporalWorkerTasknotesCanaryRbac,
} from "./audit-rbac.ts";
import { createTemporalAgentWorker } from "./agent-worker.ts";
import { createTemporalWorkerCrdReaderRbac } from "./crd-rbac.ts";
import { glitterContextEnv, glitterCorpusEnv } from "./glitter-corpus-env.ts";
import { createTemporalGlitterWorkers } from "./glitter-worker.ts";
import { createTemporalIngressWorkers } from "./ingress-workers.ts";
import { homelabAuditEnv } from "./homelab-audit-env.ts";
import { createTemporalOperationsWorkers } from "./operations-workers.ts";
import { createTemporalWorkflowWorkers } from "./workflow-worker.ts";
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
  const freshRssCredentialItem = new OnePasswordItem(
    chart,
    "temporal-freshrss-sync-1p",
    {
      metadata: { name: "temporal-freshrss-sync" },
      spec: { itemPath: vaultItemPath("freshrss-sync") },
    },
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

  createTemporalWorkerIngressReaderRbac(chart, [infraServiceAccount]);
  createTemporalWorkerMaintenanceRbac(chart, [infraServiceAccount]);

  // Cluster-wide read-only RBAC for deterministic collectors and generic
  // report-only investigations. Only the infra worker receives the separate
  // TaskNotes exec role; the agent worker cannot exec into any pod.
  createTemporalWorkerAuditRbac(chart, [
    infraServiceAccount,
    agentServiceAccount,
  ]);
  createTemporalWorkerTasknotesCanaryRbac(chart, [infraServiceAccount]);

  // Read-only CRD access for homelab-crd-imports-daily. See ./crd-rbac.ts.
  createTemporalWorkerCrdReaderRbac(chart, [infraServiceAccount]);

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
  const agentDeployment = createTemporalAgentWorker(chart, {
    serviceAccount: agentServiceAccount,
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("agent"),
      AGENT_PROVIDER_UID: EnvValue.fromValue("1001"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
      TELEMETRY_ENABLED: EnvValue.fromValue("true"),
      OTLP_ENDPOINT: EnvValue.fromValue(
        "http://tempo.tempo.svc.cluster.local:4318",
      ),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-agent-worker"),
      NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
        "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      ),
      // Codex SDK receives the service-scoped OpenRouter key directly.
      OPENROUTER_API_KEY: EnvValue.fromSecretValue({
        secret,
        key: "OPENROUTER_API_KEY",
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

  const workflowDeployments = createTemporalWorkflowWorkers(chart, {
    serverServiceName: props.serverServiceName,
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

  return {
    agentDeployment,
    gatewayDeployment,
    homeDeployment,
    reportsDeployment,
    workflowDeployment: workflowDeployments.stable,
    workflowCandidateDeployment: workflowDeployments.candidate,
    infraDeployment,
    repoDeployment,
    scoutDeployment,
    glitterCorpusDeployment: corpusDeployment,
    glitterContextDeployment: contextDeployment,
  };
}
