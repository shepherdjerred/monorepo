import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

export function createBirmelDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "birmel", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: 1000,
      ensureNonRoot: false,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Birmel requires flexible user permissions for container operations",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Birmel requires writable filesystem for SQLite databases",
      },
    },
  });

  const onePasswordItem = new OnePasswordItem(chart, "birmel-1p", {
    spec: {
      itemPath: vaultItemPath("w5c27dzybxor3j6dzl7lub2soe"),
    },
  });

  // Mirror the SeaweedFS S3 access credentials (the human-friendly
  // SEAWEEDFS_ACCESS_KEY_ID / SEAWEEDFS_SECRET_ACCESS_KEY pair — same item
  // used by s3-static-sites) into birmel's namespace so the LLM archive can
  // PUT to s3://llm-archive without crossing namespaces.
  const seaweedfsCreds = new OnePasswordItem(chart, "birmel-seaweedfs-1p", {
    spec: {
      itemPath: vaultItemPath("vet52jaeh75chsalu6lulugium"),
    },
    metadata: {
      name: "birmel-seaweedfs-s3-credentials",
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "birmel-pvc", {
    storage: Size.gibibytes(2),
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/birmel:${versions["shepherdjerred/birmel"]}`,
      securityContext: {
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      ports: [{ number: 4112, name: "oauth" }],
      volumeMounts: [
        {
          path: "/app/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "birmel-volume",
            localPathVolume.claim,
          ),
        },
      ],
      envVariables: {
        // Discord credentials
        DISCORD_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-discord-token-secret",
            onePasswordItem.name,
          ),
          key: "DISCORD_TOKEN",
        }),
        DISCORD_CLIENT_ID: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-discord-client-id-secret",
            onePasswordItem.name,
          ),
          key: "DISCORD_CLIENT_ID",
        }),

        // OpenAI configuration
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-openai-api-key-secret",
            onePasswordItem.name,
          ),
          key: "OPENAI_API_KEY",
        }),
        OPENAI_MODEL: EnvValue.fromValue("gpt-5.5"),
        OPENAI_CLASSIFIER_MODEL: EnvValue.fromValue("gpt-5.4-nano"),
        OPENAI_REASONING_EFFORT: EnvValue.fromValue("medium"),
        OPENAI_TEXT_VERBOSITY: EnvValue.fromValue("low"),

        // Anthropic configuration
        ANTHROPIC_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-anthropic-api-key-secret",
            onePasswordItem.name,
          ),
          key: "ANTHROPIC_API_KEY",
        }),

        // Database paths
        DATABASE_URL: EnvValue.fromValue("file:/app/data/birmel.db"),
        OPS_DATABASE_URL: EnvValue.fromValue("file:/app/data/birmel-ops.db"),
        // Keep the existing on-disk filename so the production database
        // doesn't get re-created when this rolls out. The schema config now
        // accepts `MEMORY_DB_PATH` as the canonical name; the legacy
        // `MASTRA_MEMORY_DB_PATH` env var is still accepted as a fallback by
        // the bot, but every code reference uses the new name.
        MEMORY_DB_PATH: EnvValue.fromValue("file:/app/data/mastra-memory.db"),

        // Telemetry configuration (OpenTelemetry)
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("birmel"),
        OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),

        ...llmArchiveEnvVars(),
        S3_ENDPOINT: EnvValue.fromValue(
          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        ),
        S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-aws-access-key-id",
            seaweedfsCreds.name,
          ),
          key: "SEAWEEDFS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-aws-secret-access-key",
            seaweedfsCreds.name,
          ),
          key: "SEAWEEDFS_SECRET_ACCESS_KEY",
        }),

        // Sentry configuration
        SENTRY_ENABLED: EnvValue.fromValue("true"),
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-sentry-dsn-secret",
            onePasswordItem.name,
          ),
          key: "SENTRY_DSN",
        }),
        SENTRY_ENVIRONMENT: EnvValue.fromValue("production"),
        SENTRY_RELEASE: EnvValue.fromValue(
          versions["shepherdjerred/birmel"].split("@")[0] ??
            versions["shepherdjerred/birmel"],
        ),

        // General configuration
        LOG_LEVEL: EnvValue.fromValue("info"),
        VOICE_ENABLED: EnvValue.fromValue("true"),
        DAILY_POSTS_ENABLED: EnvValue.fromValue("true"),
        WEB_SEARCH_PROVIDER: EnvValue.fromValue("openai"),
        // The browser tool is temporarily disabled. The PINCHTAB_TOKEN secret
        // key does not exist in the Birmel 1Password item, which crashed the pod
        // with CreateContainerConfigError, and pinchtab is not yet deployed
        // in-cluster (the pinchtab namespace is empty). Disable the browser until
        // the in-cluster pinchtab service lands, at which point BROWSER_ENABLED is
        // removed and PINCHTAB_TOKEN is sourced from a shared "PinchTab" item.
        BROWSER_ENABLED: EnvValue.fromValue("false"),
        BROWSER_PROVIDER: EnvValue.fromValue("pinchtab"),
        PINCHTAB_BASE_URL: EnvValue.fromValue(
          "http://pinchtab.pinchtab.svc.cluster.local:9867",
        ),
        PINCHTAB_PROFILE: EnvValue.fromValue("birmel"),

        // Editor configuration
        EDITOR_ENABLED: EnvValue.fromValue("true"),
        EDITOR_OAUTH_PORT: EnvValue.fromValue("4112"),
        EDITOR_ALLOWED_REPOS: EnvValue.fromValue(
          JSON.stringify([
            {
              name: "scout-for-lol",
              repo: "shepherdjerred/monorepo",
              branch: "main",
            },
            {
              name: "monorepo",
              repo: "shepherdjerred/monorepo",
              branch: "main",
            },
          ]),
        ),
        EDITOR_GITHUB_CLIENT_ID: EnvValue.fromValue("Ov23liCMrfCR1Ggvx99o"),
        EDITOR_GITHUB_CLIENT_SECRET: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-editor-github-secret",
            onePasswordItem.name,
          ),
          key: "EDITOR_GITHUB_CLIENT_SECRET",
        }),
        EDITOR_GITHUB_CALLBACK_URL: EnvValue.fromValue(
          "https://birmel-oauth.tailnet-1a49.ts.net/auth/github/callback",
        ),
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Service for Editor OAuth
  const oauthService = new Service(chart, "birmel-oauth-service", {
    selector: deployment,
    ports: [{ port: 4112, name: "oauth" }],
  });

  new TailscaleIngress(chart, "birmel-oauth-ingress", {
    service: oauthService,
    host: "birmel-oauth",
  });

  createCloudflareTunnelBinding(chart, "birmel-oauth-cf-tunnel", {
    serviceName: oauthService.name,
    subdomain: "birmel-oauth",
  });
}
