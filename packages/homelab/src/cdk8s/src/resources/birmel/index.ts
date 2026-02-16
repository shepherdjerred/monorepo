import { Deployment, DeploymentStrategy, EnvValue, Secret, Service, Volume } from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { withCommonProps } from "../../misc/common.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";

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
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Birmel requires writable filesystem for SQLite databases",
      },
    },
  });

  const onePasswordItem = new OnePasswordItem(chart, "birmel-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/w5c27dzybxor3j6dzl7lub2soe",
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
      ports: [
        { number: 4111, name: "studio" },
        { number: 4112, name: "oauth" },
      ],
      volumeMounts: [
        {
          path: "/app/data",
          volume: Volume.fromPersistentVolumeClaim(chart, "birmel-volume", localPathVolume.claim),
        },
      ],
      envVariables: {
        // Discord credentials
        DISCORD_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "birmel-discord-token-secret", onePasswordItem.name),
          key: "discord-api-token",
        }),
        DISCORD_CLIENT_ID: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "birmel-discord-client-id-secret", onePasswordItem.name),
          key: "discord-client-id",
        }),

        // OpenAI configuration
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "birmel-openai-api-key-secret", onePasswordItem.name),
          key: "openai-api-key",
        }),
        OPENAI_MODEL: EnvValue.fromValue("gpt-5-mini"),
        OPENAI_CLASSIFIER_MODEL: EnvValue.fromValue("gpt-5-nano"),

        // Anthropic configuration
        ANTHROPIC_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "birmel-anthropic-api-key-secret", onePasswordItem.name),
          key: "anthropic-api-key",
        }),

        // Database paths
        DATABASE_URL: EnvValue.fromValue("file:/app/data/birmel.db"),
        OPS_DATABASE_URL: EnvValue.fromValue("file:/app/data/birmel-ops.db"),
        MASTRA_MEMORY_DB_PATH: EnvValue.fromValue("file:/app/data/mastra-memory.db"),

        // Mastra Studio configuration
        MASTRA_STUDIO_ENABLED: EnvValue.fromValue("true"),
        MASTRA_STUDIO_PORT: EnvValue.fromValue("4111"),
        MASTRA_STUDIO_HOST: EnvValue.fromValue("0.0.0.0"),

        // Telemetry configuration (OpenTelemetry)
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("birmel"),
        OTLP_ENDPOINT: EnvValue.fromValue("http://tempo.tempo.svc.cluster.local:4318"),

        // Sentry configuration
        SENTRY_ENABLED: EnvValue.fromValue("true"),
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "birmel-sentry-dsn-secret", onePasswordItem.name),
          key: "sentry-dsn",
        }),
        SENTRY_ENVIRONMENT: EnvValue.fromValue("production"),
        SENTRY_RELEASE: EnvValue.fromValue(versions["shepherdjerred/birmel"]),

        // General configuration
        LOG_LEVEL: EnvValue.fromValue("info"),
        VOICE_ENABLED: EnvValue.fromValue("true"),
        DAILY_POSTS_ENABLED: EnvValue.fromValue("true"),

        // Editor configuration
        EDITOR_ENABLED: EnvValue.fromValue("true"),
        EDITOR_OAUTH_PORT: EnvValue.fromValue("4112"),
        EDITOR_ALLOWED_REPOS: EnvValue.fromValue(
          JSON.stringify([
            { name: "scout-for-lol", repo: "shepherdjerred/scout-for-lol", branch: "main" },
            { name: "monorepo", repo: "shepherdjerred/monorepo", branch: "main" },
          ]),
        ),
        EDITOR_GITHUB_CLIENT_ID: EnvValue.fromValue("Ov23liCMrfCR1Ggvx99o"),
        EDITOR_GITHUB_CLIENT_SECRET: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "birmel-editor-github-secret", onePasswordItem.name),
          key: "editor-github-client-secret",
        }),
        EDITOR_GITHUB_CALLBACK_URL: EnvValue.fromValue("https://birmel-oauth.tailnet-1a49.ts.net/auth/github/callback"),
      },
    }),
  );

  // Service for Mastra Studio
  const studioService = new Service(chart, "birmel-studio-service", {
    selector: deployment,
    ports: [{ port: 4111, name: "studio" }],
  });

  // TailscaleIngress for internal access to Studio (no funnel)
  new TailscaleIngress(chart, "birmel-studio-ingress", {
    service: studioService,
    host: "birmel-studio",
  });

  // Service for Editor OAuth
  const oauthService = new Service(chart, "birmel-oauth-service", {
    selector: deployment,
    ports: [{ port: 4112, name: "oauth" }],
  });

  // TailscaleIngress with funnel for OAuth (publicly accessible for GitHub callback)
  new TailscaleIngress(chart, "birmel-oauth-ingress", {
    service: oauthService,
    host: "birmel-oauth",
    funnel: true,
  });
}
