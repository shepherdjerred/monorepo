import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type ISecret,
  Secret,
  Service,
  ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  createTemporalWorkerAuditRbac,
  createTemporalWorkerTasknotesCanaryRbac,
} from "./audit-rbac.ts";
import { createTemporalAgentWorker } from "./agent-worker.ts";
import { createTemporalWorkerCrdReaderRbac } from "./crd-rbac.ts";
import { sleepWebhookEnv } from "./http-services.ts";
import { glitterCorpusEnv } from "./glitter-corpus-env.ts";
import { createTemporalGlitterWorker } from "./glitter-worker.ts";
import { temporalWorkerHealthProbes } from "./worker-health.ts";
import { createTemporalWorkerHttpServices } from "./worker-http-services.ts";
import {
  createTemporalWorkerMaintenanceRbac,
  createTemporalWorkerServiceAccount,
} from "./worker-rbac.ts";

export type CreateTemporalWorkerDeploymentProps = {
  serverServiceName: string;
};

/**
 * Build a map of `KEY: EnvValue.fromSecretValue(...)` entries for the
 * homelab-audit-daily workflow credentials. Every field is REQUIRED: if a 1P
 * field is unset the pod fails to start (CreateContainerConfigError) rather
 * than booting with a silently-missing secret. This is the fail-fast contract
 * for the whole repo — no `optional: true` on secrets. The 1P item must carry
 * every key referenced here.
 */
function requiredSecretEnv(
  secret: ISecret,
  keys: readonly string[],
): Record<string, EnvValue> {
  const env: Record<string, EnvValue> = {};
  for (const key of keys) {
    env[key] = EnvValue.fromSecretValue({ secret, key });
  }
  return env;
}

function homelabAuditEnv(secret: ISecret): Record<string, EnvValue> {
  return {
    // homelab-audit-daily workflow credentials. All required — a missing 1P
    // field crash-loops the pod (fail-fast) instead of starting with a gap.
    BUGSINK_URL: EnvValue.fromValue("https://bugsink.sjer.red"),
    BUILDKITE_ORGANIZATION_SLUG: EnvValue.fromValue("sjerred"),
    BUILDKITE_PIPELINE_SLUG: EnvValue.fromValue("monorepo"),
    PROMETHEUS_URL: EnvValue.fromValue(
      "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
    ),
    // gcx stores its credential in a config file, written by
    // ensureGcxContext() (src/activities/gcx-context.ts) at audit time from the
    // GRAFANA_URL/GRAFANA_API_KEY below. Its default location is
    // $HOME/.config/gcx/config.yaml, which resolves to /home/bun from the
    // oven/bun base image and is writable by uid 1000. Pinning the path anyway
    // keeps the credential's location independent of the base image, so a bun
    // bump that changes HOME cannot silently relocate it.
    GCX_CONFIG: EnvValue.fromValue("/tmp/gcx/config.yaml"),
    // Suppress gcx's outbound GitHub release check and anonymous telemetry; a
    // homelab worker should make no unsolicited egress. ensureGcxContext()
    // spawns gcx with an allowlisted environment, so both names must stay in
    // its GCX_INHERITED_ENV or they never reach the process they constrain.
    GCX_NO_UPDATE_NOTIFIER: EnvValue.fromValue("1"),
    GCX_TELEMETRY: EnvValue.fromValue("disabled"),
    ...requiredSecretEnv(secret, [
      "BUGSINK_TOKEN",
      "GRAFANA_URL",
      "GRAFANA_API_KEY",
      "ARGOCD_SERVER",
      "ARGOCD_AUTH_TOKEN",
      "CLOUDFLARE_API_TOKEN",
      "BUILDKITE_API_TOKEN",
    ]),
    ALERT_DASHBOARD_URL: EnvValue.fromValue(
      "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    ),
    // talosctl reads its config from $TALOSCONFIG; the secret volume below
    // projects 1P field TALOSCONFIG_YAML to this path.
    TALOSCONFIG: EnvValue.fromValue("/etc/talos/config"),
  };
}

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

  const serviceAccount = createTemporalWorkerServiceAccount(chart);
  const agentServiceAccount = new ServiceAccount(
    chart,
    "temporal-agent-worker-sa",
    {
      metadata: { name: "temporal-agent-worker" },
    },
  );

  createTemporalWorkerMaintenanceRbac(chart, serviceAccount);

  // Cluster-wide read-only RBAC for deterministic collectors and generic
  // report-only investigations. Only the core worker receives the separate
  // TaskNotes exec role; the agent worker cannot exec into any pod.
  createTemporalWorkerAuditRbac(chart, [serviceAccount, agentServiceAccount]);
  createTemporalWorkerTasknotesCanaryRbac(chart, serviceAccount);

  // Read-only CRD access for homelab-crd-imports-daily. See ./crd-rbac.ts.
  createTemporalWorkerCrdReaderRbac(chart, serviceAccount);

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
      // :9466 = GitHub webhook receiver (Hono server in event-bridge/
      //        github-webhook.ts) — exposed via Cloudflare Tunnel for PR
      //        review/summary events.
      // :9467 = authenticated agent-task scheduling API.
      // :9468 = Xcode Cloud webhook receiver (Hono server in event-bridge/
      //        xcode-cloud-webhook.ts) — exposed via Cloudflare Tunnel; POSTs
      //        iOS build failures into Alertmanager.
      // :9469 = authenticated iOS sleep automation webhook.
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
        { number: 9466, name: "gh-webhook" },
        { number: 9467, name: "agent-tasks" },
        { number: 9468, name: "xc-webhook" },
        { number: 9469, name: "sleep-webhook" },
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
          request: Size.gibibytes(3),
          limit: Size.gibibytes(6),
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        TEMPORAL_WORKER_ROLE: EnvValue.fromValue("core"),
        ENVIRONMENT: EnvValue.fromValue("production"),
        // Keep headless Claude subprocesses from starting optional traffic or updates.
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: EnvValue.fromValue("1"),
        DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
        // OpenTelemetry tracing → Tempo. initializeTracing() in worker.ts
        // gates on TELEMETRY_ENABLED.
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-worker"),
        // Git identity for any activity that runs `git commit`.
        GIT_AUTHOR_NAME: EnvValue.fromValue("temporal-worker[bot]"),
        GIT_AUTHOR_EMAIL: EnvValue.fromValue("temporal-worker@homelab.local"),
        GIT_COMMITTER_NAME: EnvValue.fromValue("temporal-worker[bot]"),
        GIT_COMMITTER_EMAIL: EnvValue.fromValue(
          "temporal-worker@homelab.local",
        ),
        // Trust the in-cluster CA for Bun and @kubernetes/client-node TLS calls.
        NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
          "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
        ),
        // Home Assistant
        HA_URL: EnvValue.fromSecretValue({ secret, key: "HA_URL" }),
        HA_TOKEN: EnvValue.fromSecretValue({ secret, key: "HA_TOKEN" }),
        // S3 / SeaweedFS (for fetcher)
        S3_BUCKET_NAME: EnvValue.fromSecretValue({
          secret,
          key: "S3_BUCKET_NAME",
        }),
        S3_ENDPOINT: EnvValue.fromSecretValue({ secret, key: "S3_ENDPOINT" }),
        S3_KEY: EnvValue.fromValue("data/manifest.json"),
        S3_REGION: EnvValue.fromValue("us-east-1"),
        AWS_REGION: EnvValue.fromValue("us-east-1"),
        AWS_DEFAULT_REGION: EnvValue.fromValue("us-east-1"),
        S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
        ...llmArchiveEnvVars(),
        // The deterministic homelab audit stores typed report state and email
        // acceptance receipts through the shared report sender. Legacy audit
        // archive variables remain intentionally unwired for history replay.
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret,
          key: "AWS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret,
          key: "AWS_SECRET_ACCESS_KEY",
        }),
        ...glitterCorpusEnv(secret, starlightBotSecret),
        // GitHub
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
        // GitHub webhook ingest for the merge-conflict check (push +
        // pull_request) and PR-closed Buildkite build cancellation (closed).
        // GitHub API, clone, and commit-status operations mint short-lived
        // installation tokens from the app credentials above.
        GITHUB_WEBHOOK_SECRET: EnvValue.fromSecretValue({
          secret,
          key: "GITHUB_WEBHOOK_SECRET",
        }),
        // Claude Code subscription OAuth token — sole auth for every `claude -p`
        // subprocess (homelab synthesis, generic agent-task, Scout season).
        // All work bills against the subscription; ANTHROPIC_API_KEY is
        // deliberately absent so a leaked key can't start direct-API billing.
        CLAUDE_CODE_OAUTH_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "CLAUDE_CODE_OAUTH_TOKEN",
        }),
        GITHUB_WEBHOOK_PORT: EnvValue.fromValue("9466"),
        AGENT_TASK_API_PORT: EnvValue.fromValue("9467"),
        AGENT_TASK_API_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "AGENT_TASK_API_TOKEN",
        }),
        ...sleepWebhookEnv(secret),
        // Xcode Cloud webhook receiver (event-bridge/xcode-cloud-webhook.ts).
        // The receiver only starts when XCODE_CLOUD_WEBHOOK_TOKEN is set; the
        // token authenticates the unguessable URL path (Xcode Cloud webhooks
        // carry no signature). On a FAILED/ERRORED iOS build it POSTs a
        // `severity=warning` alert to Alertmanager, which the existing route
        // forwards to the Alerts dashboard. Required — the 1P item carries
        // XCODE_CLOUD_WEBHOOK_TOKEN.
        XCODE_CLOUD_WEBHOOK_PORT: EnvValue.fromValue("9468"),
        XCODE_CLOUD_WEBHOOK_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "XCODE_CLOUD_WEBHOOK_TOKEN",
        }),
        // In-cluster Alertmanager write API. Non-sensitive; a plain literal.
        ALERTMANAGER_URL: EnvValue.fromValue(
          "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
        ),
        // Bugsink (Sentry-compatible) error tracking. Read by initSentry()
        // in worker.ts. Required — the 1P item carries SENTRY_DSN.
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret,
          key: "SENTRY_DSN",
        }),
        // OpenAI. Codex CLI 0.139+ authenticates via CODEX_API_KEY only —
        // OPENAI_API_KEY alone yields "401 Missing bearer" on /v1/responses.
        // Same 1P field; no second secret.
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "OPENAI_API_KEY",
        }),
        CODEX_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "OPENAI_API_KEY",
        }),
        // Postal email
        POSTAL_HOST: EnvValue.fromSecretValue({ secret, key: "POSTAL_HOST" }),
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
        // Sender domain must have valid SPF/DKIM for the recipient's mail
        // server to accept delivery. The previous literal `updates@homelab.local`
        // was non-routable and got silently dropped by external recipients.
        // Sourced from 1Password (item `temporal-temporal-worker-1p`, key
        // `SENDER_EMAIL`) so the address can rotate without code changes.
        // Required — the 1P item carries SENDER_EMAIL.
        SENDER_EMAIL: EnvValue.fromSecretValue({
          secret,
          key: "SENDER_EMAIL",
        }),
        ...homelabAuditEnv(secret),
      },
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
      OPENAI_API_KEY: EnvValue.fromSecretValue({
        secret,
        key: "OPENAI_API_KEY",
      }),
      CODEX_API_KEY: EnvValue.fromSecretValue({
        secret,
        key: "OPENAI_API_KEY",
      }),
      PROMETHEUS_URL: EnvValue.fromValue(
        "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
      ),
      ALERT_DASHBOARD_URL: EnvValue.fromValue(
        "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
      ),
    },
  });

  // Glitter's corpus and context-refresh queues perform the heaviest Bun-side
  // work. Keep them in a separate process and pod so a runtime wedge or
  // resource spike cannot stop schedules, webhooks, or the general queues.
  const glitterDeployment = createTemporalGlitterWorker(chart, {
    serviceAccount,
    envVariables: {
      ...container.env.variables,
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("glitter"),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-glitter-worker"),
    },
  });

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

  createTemporalWorkerHttpServices(chart, deployment);

  return { deployment, agentDeployment, glitterDeployment };
}
