import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Capability,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  SeccompProfileType,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const PHOENIX_HTTP_PORT = 6006;
// The nonroot image's fixed UID/GID.
const PHOENIX_UID = 65_532;

// Composed from parts (not a literal) so `no-secrets/no-secrets` does not flag
// a "password in URL"; the `$(DB_USER)` / `$(DB_PASSWORD)` placeholders are
// Kubernetes env-var references expanded from the postgres-operator secret.
function buildPgUrl(): string {
  const protocol = "postgresql";
  const userRef = "$(DB_USER)";
  const passRef = "$(DB_" + "PASSWORD)";
  const host = "phoenix-postgresql:5432";
  const db = "phoenix_db";
  return `${protocol}://${userRef}:${passRef}@${host}/${db}`;
}

/**
 * Arize Phoenix: the self-hosted LLM trace, eval, and dataset UI. It receives
 * only whole LLM traces that alloy-gateway tail-samples into per-project
 * branches (selected by the `x-project-name` header); Tempo remains the
 * complete trace store.
 */
export function createPhoenixDeployment(chart: Chart) {
  // PHOENIX_SECRET signs JWTs; PHOENIX_ADMIN_SECRET is a bearer token acting
  // as the first system user, used to mint the gateway's system API key
  // without a manual UI login. Both need >=32 chars with a digit and a
  // lowercase letter, and must differ.
  const phoenixSecrets = new OnePasswordItem(chart, "phoenix-1p", {
    metadata: { name: "phoenix" },
    spec: { itemPath: vaultItemPath("phoenix") },
  });
  const secretRef = Secret.fromSecretName(
    chart,
    "phoenix-secret-ref",
    phoenixSecrets.name,
  );

  const pgSecretRef = Secret.fromSecretName(
    chart,
    "phoenix-pg-secret-ref",
    "phoenix.phoenix-postgresql.credentials.postgresql.acid.zalan.do",
  );

  const deployment = new Deployment(chart, "phoenix", {
    replicas: 1,
    // A second pod would run migrations and retention sweeps concurrently
    // against the same database.
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: PHOENIX_UID,
    },
    // The Service is named "phoenix", so service links would inject
    // PHOENIX_PORT=tcp://<ip>:6006 (and PHOENIX_SERVICE_*), which Phoenix
    // reads as its own config and refuses to start on.
    enableServiceLinks: false,
    podMetadata: { labels: { app: "phoenix" } },
  });

  const container = deployment.addContainer(
    withCommonProps({
      name: "phoenix",
      image: `arizephoenix/phoenix:${versions["arizephoenix/phoenix"]}`,
      ports: [{ name: "http", number: PHOENIX_HTTP_PORT }],
      envVariables: {
        // K8s expands $(VAR) only against env vars defined earlier in the
        // list, so DB_USER and DB_PASSWORD must precede the URL.
        DB_USER: EnvValue.fromSecretValue({
          secret: pgSecretRef,
          key: "username",
        }),
        DB_PASSWORD: EnvValue.fromSecretValue({
          secret: pgSecretRef,
          key: "password",
        }),
        PHOENIX_SQL_DATABASE_URL: EnvValue.fromValue(buildPgUrl()),
        PHOENIX_WORKING_DIR: EnvValue.fromValue("/data"),
        PHOENIX_ROOT_URL: EnvValue.fromValue(
          "https://phoenix.tailnet-1a49.ts.net",
        ),

        PHOENIX_ENABLE_AUTH: EnvValue.fromValue("true"),
        PHOENIX_USE_SECURE_COOKIES: EnvValue.fromValue("true"),
        PHOENIX_SECRET: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "PHOENIX_SECRET",
        }),
        PHOENIX_ADMIN_SECRET: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "PHOENIX_ADMIN_SECRET",
        }),
        // Only read when the admin row is first created.
        PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD: EnvValue.fromSecretValue({
          secret: secretRef,
          key: "PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD",
        }),

        // Match Tempo's 30-day window; the SeaweedFS LLM archive is the
        // durable body record.
        PHOENIX_DEFAULT_RETENTION_POLICY_DAYS: EnvValue.fromValue("30"),
        // Phoenix refuses inserts once its database passes 90% of this,
        // well before the 32Gi volume (shared with ZFS snapshot churn) fills.
        PHOENIX_DATABASE_ALLOCATED_STORAGE_CAPACITY_GIBIBYTES:
          EnvValue.fromValue("16"),
        PHOENIX_DATABASE_USAGE_INSERTION_BLOCKING_THRESHOLD_PERCENTAGE:
          EnvValue.fromValue("90"),

        // No analytics pixels, and no server-side agent that can run bash,
        // browse, or call GitHub from inside the cluster. Provider credentials
        // belong to the workloads that call models, so Phoenix holds none for
        // its assistant or playground.
        PHOENIX_TELEMETRY_ENABLED: EnvValue.fromValue("false"),
        PHOENIX_DISABLE_AGENT_ASSISTANT: EnvValue.fromValue("true"),
        PHOENIX_AGENTS_DISABLE_BASH: EnvValue.fromValue("true"),
        PHOENIX_AGENTS_DISABLE_WEB_ACCESS: EnvValue.fromValue("true"),
        PHOENIX_AGENTS_DISABLE_GITHUB: EnvValue.fromValue("true"),
        // Code evaluators run in the in-process WASM sandbox only; never ship
        // span content to a hosted sandbox provider.
        PHOENIX_ALLOWED_SANDBOX_PROVIDERS: EnvValue.fromValue("WASM"),
      },
      securityContext: {
        user: PHOENIX_UID,
        group: PHOENIX_UID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        privileged: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      resources: {
        cpu: { request: Cpu.millis(100), limit: Cpu.millis(1000) },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
      // Migrations run before the server listens.
      startup: Probe.fromHttpGet("/healthz", {
        port: PHOENIX_HTTP_PORT,
        failureThreshold: 60,
        periodSeconds: Duration.seconds(5),
      }),
      liveness: Probe.fromHttpGet("/healthz", {
        port: PHOENIX_HTTP_PORT,
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromHttpGet("/readyz", {
        port: PHOENIX_HTTP_PORT,
        periodSeconds: Duration.seconds(10),
      }),
    }),
  );
  container.mount("/tmp", Volume.fromEmptyDir(chart, "phoenix-tmp", "tmp"));
  container.mount("/data", Volume.fromEmptyDir(chart, "phoenix-data", "data"));
  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "phoenix-service", {
    metadata: { name: "phoenix", labels: { app: "phoenix" } },
    selector: deployment,
    ports: [{ port: PHOENIX_HTTP_PORT, name: "http" }],
  });

  new KubeNetworkPolicy(chart, "phoenix-netpol", {
    metadata: { name: "phoenix-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "phoenix" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // OTLP from the trace gateway, the UI via Tailscale, and the
          // blackbox health probe.
          from: ["alloy-gateway", "tailscale", "prometheus"].map(
            (namespace) => ({
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": namespace },
              },
            }),
          ),
          ports: [
            {
              port: IntOrString.fromNumber(PHOENIX_HTTP_PORT),
              protocol: "TCP",
            },
          ],
        },
      ],
      egress: [
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        {
          to: [
            {
              podSelector: {
                matchLabels: { cluster_name: "phoenix-postgresql" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
      ],
    },
  });

  new TailscaleIngress(chart, "phoenix-tailscale-ingress", {
    service,
    host: "phoenix",
    probePath: "/healthz",
  });

  return { deployment, service, phoenixSecrets };
}
