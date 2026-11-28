import { temporalMetricsAddressEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/telemetry.ts";
import { temporalAddressEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/address.ts";
import { Size, type Chart } from "cdk8s";
import { ZfsSataVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-sata-volume.ts";
import { codexApiKeyEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-provider-credentials.ts";
import { EnvValue, Secret, ServiceAccount, Volume } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  vaultItemPath,
  onePasswordSecret,
} from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  createTemporalWorkerAuditRbac,
  createTemporalWorkerTasknotesCanaryRbac,
} from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/audit-rbac.ts";
import { createTemporalAgentWorker } from "./agent-worker.ts";
import { createTemporalWorkerCrdReaderRbac } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/crd-rbac.ts";
import { createTemporalWorkerCiWorkspaceReaperRbac } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/ci-workspace-reaper-rbac.ts";
import { createTemporalWorkerCiWorkspaceGoldenRbac } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/ci-workspace-golden-rbac.ts";
import {
  glitterContextEnv,
  glitterCorpusEnv,
} from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/glitter-corpus-env.ts";
import { createTemporalGlitterWorkers } from "./glitter-worker.ts";
import { createTemporalIngressWorkers } from "./ingress-workers.ts";
import { homelabAuditEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/homelab-audit-env.ts";
import { createTemporalOperationsWorkers } from "./operations-workers.ts";
import { createTemporalWorkflowWorkers } from "./workflow-worker.ts";
import {
  createTemporalWorkerMaintenanceRbac,
  createTemporalStormRbac,
  createTemporalWorkerServiceAccount,
} from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/worker-rbac.ts";
import { temporalFeatureFlagEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/feature-flags.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { createTemporalPromotionWorker } from "./promotion-worker.ts";
import {
  telemetryEnv,
  bugsinkEnv,
  seaweedfsS3,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

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
  const promotionDeployment = createTemporalPromotionWorker(chart, {
    serverServiceName: props.serverServiceName,
    temporalSecret: secret,
  });
  const flagsAuthItem = onePasswordSecret(
    chart,
    "temporal-flags-auth-1p",
    "dzcroze2qcoibfz3illceozbea",
    { name: "flags-auth" },
  );
  const flagsAuthSecret = Secret.fromSecretName(
    chart,
    "temporal-flags-auth-secret",
    flagsAuthItem.name,
  );
  const feedsAuthItem = onePasswordSecret(
    chart,
    "temporal-feeds-auth-1p",
    "hs2u3hto2k2e77sdjceh6pkuru",
    { name: "feeds-auth" },
  );
  const feedsAuthSecret = Secret.fromSecretName(
    chart,
    "temporal-feeds-auth-secret",
    feedsAuthItem.name,
  );
  const ciGithubItem = onePasswordSecret(
    chart,
    "temporal-ci-github-credentials-1p",
    "34gzcrhwdm34lpadyly3rcsu44",
    { name: "temporal-ci-github-credentials" },
  );
  const ciGithubSecret = Secret.fromSecretName(
    chart,
    "temporal-ci-github-credentials-secret",
    ciGithubItem.name,
  );
  // The read-only `homelab-audit` ArgoCD account's token, minted by
  // the argocd OpenTofu stack (homelab-cdktn/src/stacks/argocd.ts). The
  // construct id keeps the generated item and Secret names stable.
  const argocdItem = new OnePasswordItem(chart, "temporal-argocd-admin-1p", {
    spec: { itemPath: vaultItemPath("4ohxvipg3qrpaetx4jycekjavi") },
  });
  const argocdSecret = Secret.fromSecretName(
    chart,
    "temporal-argocd-admin-secret",
    argocdItem.name,
  );
  const photonItem = new OnePasswordItem(chart, "temporal-photon-1p", {
    spec: { itemPath: vaultItemPath("f67iy2i34gonqynkm2vtsvnueu") },
  });
  const photonSecret = Secret.fromSecretName(
    chart,
    "temporal-photon-secret",
    photonItem.name,
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
  const agentCodexCredentialItem = onePasswordSecret(
    chart,
    "temporal-agent-codex-1p",
    "hwyhh64dyu3s7w37q7oj7r4qn4",
    { name: "temporal-agent-codex" },
  );
  const agentCodexCredential = Secret.fromSecretName(
    chart,
    "temporal-agent-codex-secret",
    agentCodexCredentialItem.name,
  );
  const openAiUsageMonitorItem = new OnePasswordItem(
    chart,
    "temporal-openai-usage-monitor-1p",
    {
      metadata: { name: "temporal-openai-usage-monitor" },
      spec: { itemPath: vaultItemPath("openai-usage-monitor") },
    },
  );
  const openAiUsageMonitorSecret = Secret.fromSecretName(
    chart,
    "temporal-openai-usage-monitor-secret",
    openAiUsageMonitorItem.name,
  );

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

  createTemporalWorkerMaintenanceRbac(chart, [infraServiceAccount]);
  createTemporalStormRbac(chart, infraServiceAccount);

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

  // Deletes leaked Woodpecker step pods and workspace claims in woodpecker-ci.
  createTemporalWorkerCiWorkspaceReaperRbac(chart, [infraServiceAccount]);

  // Snapshots the golden CI workspace and selects it for new workspaces.
  createTemporalWorkerCiWorkspaceGoldenRbac(chart, [infraServiceAccount]);

  const ddnsApiTokenItem = onePasswordSecret(
    chart,
    "temporal-ddns-api-token-1p",
    "nhyb6lnjpvjsau2gkmb7n42oeq",
    { name: "temporal-ddns-api-token" },
  );
  const ddnsApiTokenSecret = Secret.fromSecretName(
    chart,
    "temporal-ddns-api-token-secret",
    ddnsApiTokenItem.name,
  );
  const ddnsApiTokenVolume = Volume.fromSecret(
    chart,
    "temporal-ddns-api-token-volume",
    ddnsApiTokenSecret,
    {
      name: "ddns-api-token",
      items: { api_token: { path: "api-token" } },
      defaultMode: 0o400,
    },
  );
  const gitBackupTokenItem = onePasswordSecret(
    chart,
    "temporal-git-backup-github-token-1p",
    "zshiow4egtiuec5n7stcskyxmm",
    { name: "temporal-git-backup-github-token" },
  );
  const gitBackupTokenSecret = Secret.fromSecretName(
    chart,
    "temporal-git-backup-github-token-secret",
    gitBackupTokenItem.name,
  );
  const gitBackupTokenVolume = Volume.fromSecret(
    chart,
    "temporal-git-backup-github-token-volume",
    gitBackupTokenSecret,
    {
      name: "git-backup-github-token",
      items: { password: { path: "password" } },
      defaultMode: 0o400,
    },
  );
  const gitMirrorCachePvc = new ZfsSataVolume(
    chart,
    "temporal-git-mirror-cache",
    { storage: Size.gibibytes(128) },
  );
  // Apply alongside Deployment/temporal-temporal-repo-worker (wave 3): zfs-hdd
  // uses WaitForFirstConsumer, so a wave-0 claim stays Progressing until its
  // first pod mounts it.
  gitMirrorCachePvc.claim.metadata.addAnnotation(
    "argocd.argoproj.io/sync-wave",
    "3",
  );
  const gitMirrorCacheVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-git-mirror-cache-volume",
    gitMirrorCachePvc.claim,
  );
  const agentDeployment = createTemporalAgentWorker(chart, {
    serviceAccount: agentServiceAccount,
    envVariables: {
      ...temporalFeatureFlagEnvironment(),
      ...temporalAddressEnv(props.serverServiceName),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      ...temporalMetricsAddressEnv(),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("agent"),
      AGENT_PROVIDER_UID: EnvValue.fromValue("1001"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
      ...telemetryEnv({ serviceName: "temporal-agent-worker" }),
      ...llmArchiveEnvVars(),
      NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
        "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      ),
      // Codex SDK and the LLM runtime use Temporal's own OpenAI project key.
      ...codexApiKeyEnvVars(secret),
      CLAUDE_CODE_OAUTH_TOKEN: EnvValue.fromSecretValue({
        secret,
        key: "CLAUDE_CODE_OAUTH_TOKEN",
      }),
      CODEX_AUTH_JSON_B64: EnvValue.fromSecretValue({
        secret: agentCodexCredential,
        key: "CODEX_AUTH_JSON_B64",
      }),
      S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
      AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
        secret,
        key: "AWS_ACCESS_KEY_ID",
      }),
      AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
        secret,
        key: "AWS_SECRET_ACCESS_KEY",
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
      photonSecret,
    });

  const workflowDeployments = createTemporalWorkflowWorkers(chart, {
    serverServiceName: props.serverServiceName,
  });

  const glitterCommonEnv = {
    ...temporalFeatureFlagEnvironment(),
    ...temporalAddressEnv(props.serverServiceName),
    TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
    ...temporalMetricsAddressEnv(),
    ENVIRONMENT: EnvValue.fromValue("production"),
    ...telemetryEnv(),
    ...bugsinkEnv(secret),
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
        ...codexApiKeyEnvVars(secret),
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
  const {
    infraDeployment,
    repoDeployment,
    scoutDeployment,
    billingDeployment,
  } = createTemporalOperationsWorkers(chart, {
    serverServiceName: props.serverServiceName,
    secret,
    flagsAuthSecret,
    feedsAuthSecret,
    ciGithubSecret,
    infraServiceAccount,
    homelabAuditEnvironment: homelabAuditEnv(secret, argocdSecret),
    talosConfigVolume,
    ddnsApiTokenVolume,
    gitBackupTokenVolume,
    gitMirrorCacheVolume,
    billingSecret: openAiUsageMonitorSecret,
  });

  return {
    promotionDeployment,
    agentDeployment,
    gatewayDeployment,
    homeDeployment,
    reportsDeployment,
    workflowCandidateDeployment: workflowDeployments.candidate,
    infraDeployment,
    repoDeployment,
    scoutDeployment,
    billingDeployment,
    glitterCorpusDeployment: corpusDeployment,
    glitterContextDeployment: contextDeployment,
  };
}
