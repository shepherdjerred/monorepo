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
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createTemporalWorkerAuditRbac } from "./audit-rbac.ts";
import {
  createAgentTaskApiService,
  createTemporalWorkerGithubWebhookService,
} from "./http-services.ts";

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
    ...requiredSecretEnv(secret, [
      "PAGERDUTY_TOKEN",
      "BUGSINK_TOKEN",
      "GRAFANA_URL",
      "GRAFANA_API_KEY",
      "ARGOCD_SERVER",
      "ARGOCD_AUTH_TOKEN",
      "CLOUDFLARE_API_TOKEN",
      "BUILDKITE_API_TOKEN",
    ]),
    // talosctl reads its config from $TALOSCONFIG; the secret volume below
    // projects 1P field TALOSCONFIG_YAML to this path.
    TALOSCONFIG: EnvValue.fromValue("/etc/talos/config"),
  };
}

function createTemporalWorkerServiceAccount(chart: Chart): ServiceAccount {
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

  return serviceAccount;
}

function createTemporalWorkerMaintenanceRbac(
  chart: Chart,
  serviceAccount: ServiceAccount,
) {
  // Namespace-scoped RBAC for the ZFS maintenance workflow, which execs into
  // the zfs-zpool-collector DaemonSet pod in the prometheus namespace.
  // `kubectl exec daemonset/<name>` resolves the daemonset → pod via a
  // GET on daemonsets.apps before opening the exec stream.
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
      {
        apiGroups: ["apps"],
        resources: ["daemonsets"],
        verbs: ["get"],
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

  // Namespace-scoped RBAC for the Velero orphan-snapshot audit workflow.
  // Reads `velero.io/v1/Backup` CRs in the velero namespace and execs into
  // the openebs-zfs-localpv-node pod to enumerate ZFS snapshots.
  // See packages/docs/decisions/2026-05-05_velero-orphan-snapshot-prevention.md.
  new KubeRole(chart, "temporal-worker-velero-backups-read", {
    metadata: {
      name: "temporal-worker-velero-backups-read",
      namespace: "velero",
    },
    rules: [
      {
        apiGroups: ["velero.io"],
        resources: ["backups"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-worker-velero-backups-read-binding", {
    metadata: {
      name: "temporal-worker-velero-backups-read",
      namespace: "velero",
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-velero-backups-read",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });

  new KubeRole(chart, "temporal-worker-openebs-exec", {
    metadata: { name: "temporal-worker-openebs-exec", namespace: "openebs" },
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

  new KubeRoleBinding(chart, "temporal-worker-openebs-exec-binding", {
    metadata: { name: "temporal-worker-openebs-exec", namespace: "openebs" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-worker-openebs-exec",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: chart.namespace ?? "temporal",
      },
    ],
  });
}

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

  const serviceAccount = createTemporalWorkerServiceAccount(chart);

  createTemporalWorkerMaintenanceRbac(chart, serviceAccount);

  // Cluster-wide read-only RBAC for the homelab-audit-daily workflow. See
  // ./audit-rbac.ts for the full rule set.
  createTemporalWorkerAuditRbac(chart, serviceAccount);

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
      // :9465 = application Prometheus registry (pr_*, default Bun process
      //        metrics — see observability/metrics.ts)
      // :9466 = GitHub webhook receiver (Hono server in event-bridge/
      //        github-webhook.ts) — exposed via Cloudflare Tunnel for PR
      //        review/summary events.
      // :9467 = authenticated agent-task scheduling API.
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
        { number: 9466, name: "gh-webhook" },
        { number: 9467, name: "agent-tasks" },
      ],
      securityContext: {
        user: UID,
        group: GID,
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
          request: Size.gibibytes(2),
          limit: Size.gibibytes(6),
        },
      },
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        ENVIRONMENT: EnvValue.fromValue("production"),
        // Headless hygiene for the `claude -p` agent subprocesses: don't let
        // startup block on statsig/telemetry fetches or an auto-update check.
        // Defensive only — the historical 30-min hang was the `--json-schema`
        // CLI flag (now removed), not these; keep them off for a clean headless
        // run regardless.
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
        // Homelab-audit S3 archiving is unused — the active audit runs via
        // agentTaskWorkflow (email only) and never calls the archive activity.
        // No HOMELAB_AUDIT_ARCHIVE_* env wired (no dead optional secret).
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret,
          key: "AWS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret,
          key: "AWS_SECRET_ACCESS_KEY",
        }),
        // GitHub
        // PR_REVIEW_FIXTURES_REPO_URL is not wired — it belongs to the disabled
        // pr-review-eval feature (PR_BOT_ENABLED=false) and is not present in the
        // 1P item, so requiring it would crash-loop the worker. The eval schedule
        // self-pauses when it's absent (register-schedules.ts).
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
        // GitHub webhook ingest (pr-review / pr-summary). GitHub API, clone,
        // push, and comment operations mint short-lived installation tokens
        // from the app credentials above. CLAUDE_CODE_OAUTH_TOKEN is the auth
        // used by the claude CLI itself.
        GITHUB_WEBHOOK_SECRET: EnvValue.fromSecretValue({
          secret,
          key: "GITHUB_WEBHOOK_SECRET",
        }),
        // Anthropic: OAuth → legacy `claude -p`, API key → SDK pr-summary.
        // Sole auth for both legacy `claude -p` and the new SDK-based bot.
        // The new bot reads this via `new Anthropic({ authToken: ... })` so
        // all work bills against the Claude Code subscription. The
        // ANTHROPIC_API_KEY env var was removed once the SDK switched to
        // OAuth — keep that flag out so a leaked key can't accidentally
        // start charging direct-API billing.
        CLAUDE_CODE_OAUTH_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "CLAUDE_CODE_OAUTH_TOKEN",
        }),
        // Master kill switch for the whole PR bot (review + summary). While "false"
        // the GitHub webhook acks deliveries but posts no comments and starts no
        // workflows. Disabled because every specialist pass was failing with HTTP 429
        // rate_limit_error (swallowed, so the bot posted "0 findings" on every PR).
        // Flip to "true" to re-enable. See packages/temporal/src/event-bridge/github-webhook.ts `isPrBotEnabled`.
        PR_BOT_ENABLED: EnvValue.fromValue("false"),
        // Kill switch for the new pr-review pipeline's live posting. Set
        // "true" once the bot is dogfooded — every non-draft PR will then
        // receive a `<!-- pr-review-finding ... -->` comment. Flip back to
        // "false" to suppress posts while still running the full pipeline
        // for log inspection. The post activity reads this directly at
        // runtime — see packages/temporal/src/activities/pr-review/post.ts
        // `isPostEnabled`.
        PR_REVIEW_POST_ENABLED: EnvValue.fromValue("true"),
        PR_REVIEW_WORKER_MAX_CONCURRENT_ACTIVITIES: EnvValue.fromValue("1"),
        GITHUB_WEBHOOK_PORT: EnvValue.fromValue("9466"),
        AGENT_TASK_API_PORT: EnvValue.fromValue("9467"),
        AGENT_TASK_API_TOKEN: EnvValue.fromSecretValue({
          secret,
          key: "AGENT_TASK_API_TOKEN",
        }),
        // pr-review-bot dismissed-comments KV (Phase 9). Single Redis
        // instance is deployed inside the temporal chart via the shared
        // Redis cdk8s construct; service name is `temporal-redis-master`
        // per Bitnami standalone naming. Port 6379, no auth — intra-
        // namespace ClusterIP locked down by netpol to temporal-worker
        // only. The bot fail-closes if Redis is unreachable (skips
        // dedupe, posts all findings) so REDIS_URL pointing at a dead
        // service degrades gracefully rather than failing the workflow.
        REDIS_URL: EnvValue.fromValue(
          "redis://temporal-redis-master.temporal.svc.cluster.local:6379",
        ),
        // Comma-separated list of `owner/repo` pairs the pr-review
        // reaction-listener workflow polls every 15 min for
        // thumbs-down reactions + resolved-without-followup signals
        // (Phase 9). Empty / unset → listener is a no-op. Hard-coded
        // here rather than from 1P because the value is non-sensitive
        // and rotates with repo lineage rather than credentials.
        PR_REVIEW_LISTENER_REPOS: EnvValue.fromValue("shepherdjerred/monorepo"),
        // Bugsink (Sentry-compatible) error tracking. Read by initSentry()
        // in worker.ts. Required — the 1P item carries SENTRY_DSN.
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret,
          key: "SENTRY_DSN",
        }),
        // OpenAI
        OPENAI_API_KEY: EnvValue.fromSecretValue({
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

  createTemporalWorkerGithubWebhookService(chart, deployment);
  createAgentTaskApiService(chart, deployment);

  return { deployment };
}
