import {
  ClusterRole,
  ClusterRoleBinding,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { setRevisionHistoryLimit, withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

export function createSentinelDeployment(chart: Chart) {
  // ServiceAccount with read-only cluster access for agents (kubectl, argocd)
  const serviceAccount = new ServiceAccount(chart, "sentinel-sa", {
    automountToken: true,
  });
  const viewRole = ClusterRole.fromClusterRoleName(
    chart,
    "sentinel-view-role",
    "view",
  );
  const binding = new ClusterRoleBinding(chart, "sentinel-view-binding", {
    role: viewRole,
  });
  binding.addSubjects(serviceAccount);

  const deployment = new Deployment(chart, "sentinel", {
    replicas: 0,
    strategy: DeploymentStrategy.recreate(),
    serviceAccount,
    securityContext: {
      fsGroup: 1000,
      ensureNonRoot: false,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Sentinel requires flexible user permissions for container operations",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Sentinel requires writable filesystem for SQLite databases and agent workspaces",
      },
    },
  });

  const onePasswordItem = new OnePasswordItem(chart, "sentinel-1p", {
    spec: {
      itemPath: vaultItemPath("xjneyr3nt56u5li4anhbglnbr4"),
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "sentinel-pvc", {
    storage: Size.gibibytes(5),
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/sentinel:${versions["shepherdjerred/sentinel"]}`,
      securityContext: {
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      ports: [{ number: 3000, name: "webhooks" }],
      startup: Probe.fromHttpGet("/livez", {
        port: 3000,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 18,
      }),
      liveness: Probe.fromHttpGet("/livez", {
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/healthz", {
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      volumeMounts: [
        {
          path: "/app/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "sentinel-volume",
            localPathVolume.claim,
          ),
        },
      ],
      envVariables: {
        // Anthropic API key for Claude Agent SDK
        ANTHROPIC_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-anthropic-api-key-secret",
            onePasswordItem.name,
          ),
          key: "anthropic-api-key",
        }),

        // Discord configuration
        DISCORD_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-discord-token-secret",
            onePasswordItem.name,
          ),
          key: "discord-token",
        }),
        DISCORD_CHANNEL_ID: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-discord-channel-id-secret",
            onePasswordItem.name,
          ),
          key: "discord-channel-id",
        }),
        DISCORD_GUILD_ID: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-discord-guild-id-secret",
            onePasswordItem.name,
          ),
          key: "discord-guild-id",
        }),

        // GitHub token for PR creation and CI status
        GITHUB_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-github-token-secret",
            onePasswordItem.name,
          ),
          key: "github-token",
        }),

        // Webhook secrets
        GITHUB_WEBHOOK_SECRET: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-github-webhook-secret",
            onePasswordItem.name,
          ),
          key: "github-webhook-secret",
        }),
        PAGERDUTY_WEBHOOK_SECRET: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-pagerduty-webhook-secret",
            onePasswordItem.name,
          ),
          key: "pagerduty-webhook-secret",
        }),

        BUGSINK_WEBHOOK_SECRET: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-bugsink-webhook-secret",
            onePasswordItem.name,
          ),
          key: "bugsink-webhook-secret",
        }),
        BUILDKITE_WEBHOOK_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-buildkite-webhook-token-secret",
            onePasswordItem.name,
          ),
          key: "buildkite-webhook-token",
        }),

        // API tokens for agent access to external services
        BUILDKITE_API_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-buildkite-api-token-secret",
            onePasswordItem.name,
          ),
          key: "buildkite-api-token",
        }),
        PAGERDUTY_API_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-pagerduty-api-token-secret",
            onePasswordItem.name,
          ),
          key: "pagerduty-api-token",
        }),
        BUGSINK_API_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-bugsink-api-token-secret",
            onePasswordItem.name,
          ),
          key: "bugsink-api-token",
        }),

        // Database path
        DATABASE_URL: EnvValue.fromValue("file:/app/data/sentinel.db"),

        // Webhook server configuration
        WEBHOOKS_PORT: EnvValue.fromValue("3000"),
        WEBHOOKS_HOST: EnvValue.fromValue("0.0.0.0"),

        // Sentry configuration
        SENTRY_ENABLED: EnvValue.fromValue("true"),
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentinel-sentry-dsn-secret",
            onePasswordItem.name,
          ),
          key: "sentry-dsn",
        }),
        SENTRY_ENVIRONMENT: EnvValue.fromValue("production"),
        SENTRY_RELEASE: EnvValue.fromValue(
          versions["shepherdjerred/sentinel"].split("@")[0] ??
            versions["shepherdjerred/sentinel"],
        ),

        // Telemetry configuration (OpenTelemetry)
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("sentinel"),
        OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),

        // General configuration
        LOG_LEVEL: EnvValue.fromValue("info"),
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Service for webhook server
  const webhookService = new Service(chart, "sentinel-webhook-service", {
    selector: deployment,
    ports: [{ port: 3000, name: "webhooks" }],
  });

  new TailscaleIngress(chart, "sentinel-webhook-ingress", {
    service: webhookService,
    host: "sentinel-webhooks",
  });

  createCloudflareTunnelBinding(chart, "sentinel-webhook-cf-tunnel", {
    serviceName: webhookService.name,
    subdomain: "sentinel-webhooks",
  });
}
