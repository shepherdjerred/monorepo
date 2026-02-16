import { Cpu, Deployment, DeploymentStrategy, EnvValue, Secret, Service, Volume } from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { withCommonProps } from "../../misc/common.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../../misc/cloudflare-tunnel.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";
import type { Service as ServiceType } from "cdk8s-plus-31";

export type CreatePlausibleDeploymentProps = {
  clickhouseService: ServiceType;
};

export function createPlausibleDeployment(chart: Chart, props: CreatePlausibleDeploymentProps) {
  const UID = 1000;
  const GID = 1000;

  // 1Password secret containing:
  // - secret_key_base: Random 64+ character string for Phoenix sessions (use: openssl rand -base64 64)
  // - totp_vault_key: Random 32 character string for TOTP encryption (use: openssl rand -base64 32)
  const plausibleSecrets = new OnePasswordItem(chart, "plausible-secrets", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/grbpijpjbt2ocw3vmrue2yoelq",
    },
  });
  const secretRef = Secret.fromSecretName(chart, "plausible-secrets-ref", plausibleSecrets.name);

  // PostgreSQL credentials from postgres-operator
  const postgresSecretName = "plausible.plausible-postgresql.credentials.postgresql.acid.zalan.do";

  const deployment = new Deployment(chart, "plausible", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Plausible requires writable filesystem for Elixir runtime",
      },
    },
  });

  // Create shared volumes
  const pgSecretVolume = Volume.fromSecret(
    chart,
    "plausible-pg-secret-volume",
    Secret.fromSecretName(chart, "plausible-pg-secret", postgresSecretName),
    {
      name: "pg-secret", // Explicit name to avoid dots from postgres-operator secret name
    },
  );
  const dbUrlVolume = Volume.fromEmptyDir(chart, "plausible-db-url-volume", "plausible-db-url");

  // Init container to build DATABASE_URL from postgres-operator secret
  deployment.addInitContainer(
    withCommonProps({
      name: "build-db-url",
      image: `library/busybox:${versions["library/busybox"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        `
USER=$(cat /pg-secret/username)
PASS=$(cat /pg-secret/password)
echo "postgres://$USER:$PASS@plausible-postgresql:5432/plausible_db" > /db-url/url
echo "Database URL built successfully"
`,
      ],
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [
        {
          path: "/pg-secret",
          volume: pgSecretVolume,
          readOnly: true,
        },
        {
          path: "/db-url",
          volume: dbUrlVolume,
        },
      ],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "plausible",
      image: `plausible/analytics:${versions["plausible/analytics"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        // Read DATABASE_URL from init container, run migrations, then start
        "export DATABASE_URL=$(cat /db-url/url) && /entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh run",
      ],
      ports: [{ name: "http", number: 8000 }],
      envVariables: {
        // Base URL configuration
        BASE_URL: EnvValue.fromValue("https://plausible.tailnet-1a49.ts.net"),

        // ClickHouse configuration (plausible user with empty password)
        CLICKHOUSE_DATABASE_URL: EnvValue.fromValue(
          `http://plausible:@${props.clickhouseService.name}:8123/plausible_events_db`,
        ),

        // SMTP configuration via existing Postal server
        MAILER_ADAPTER: EnvValue.fromValue("Bamboo.SMTPAdapter"),
        SMTP_HOST_ADDR: EnvValue.fromValue("postal-postal-smtp-service.postal"),
        SMTP_HOST_PORT: EnvValue.fromValue("25"),
        SMTP_HOST_SSL_ENABLED: EnvValue.fromValue("false"),
        MAILER_EMAIL: EnvValue.fromValue("plausible@sjer.red"),

        // Security secrets from 1Password
        SECRET_KEY_BASE: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "secret_key_base",
        }),
        TOTP_VAULT_KEY: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "totp_vault_key",
        }),

        // Disable registration after initial setup
        DISABLE_REGISTRATION: EnvValue.fromValue("invite_only"),

        // Log format for better k8s integration
        LOG_FORMAT: EnvValue.fromValue("json"),
      },
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [
        {
          path: "/db-url",
          volume: dbUrlVolume,
          readOnly: true,
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
    }),
  );

  const service = new Service(chart, "plausible-service", {
    selector: deployment,
    metadata: {
      labels: { app: "plausible" },
    },
    ports: [{ port: 8000, name: "http" }],
  });

  // Tailscale Ingress with Funnel for public access
  // This allows external websites to send tracking data
  new TailscaleIngress(chart, "plausible-tailscale-ingress", {
    service,
    host: "plausible",
    funnel: true,
  });

  createCloudflareTunnelBinding(chart, "plausible-cf-tunnel", {
    serviceName: service.name,
    subdomain: "plausible",
  });

  return { deployment, service };
}
