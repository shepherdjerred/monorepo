import {
  Capability,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { addAnthropicFederation } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-workload-identity.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import {
  NET_ADMIN_FIREWALL_RESOURCES,
  netAdminFirewallSecurityContext,
} from "@shepherdjerred/homelab/cdk8s/src/misc/net-admin-firewall.ts";

export function createBirmelDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "birmel", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
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
    podMetadata: {
      annotations: {
        "ci.sjer.red/pod-security-enforcement": "privileged",
      },
    },
  });

  const firewallRunVolume = Volume.fromEmptyDir(
    chart,
    "birmel-sandbox-firewall-run",
    "sandbox-firewall-run",
  );
  deployment.addInitContainer(
    withCommonProps({
      name: "install-code-sandbox-firewall",
      image: `ghcr.io/shepherdjerred/birmel:${versions["shepherdjerred/birmel"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        `set -eu
for firewall in iptables ip6tables; do
  for uid in 1001 1002; do
    "$firewall" -A OUTPUT -m owner --uid-owner "$uid" -j REJECT
  done
  "$firewall" -L OUTPUT -n
done`,
      ],
      securityContext: netAdminFirewallSecurityContext(true),
      volumeMounts: [{ path: "/run", volume: firewallRunVolume }],
      resources: NET_ADMIN_FIREWALL_RESOURCES,
    }),
  );

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

  // Shared "PinchTab" 1Password item synced into the birmel namespace so birmel
  // and the in-cluster pinchtab service (pinchtab namespace) share one bearer
  // token. Same item is referenced by resources/pinchtab/index.ts.
  const pinchtabCreds = new OnePasswordItem(chart, "birmel-pinchtab-1p", {
    spec: {
      itemPath: vaultItemPath("t2dgtdx47yd2gegad6zeelzylu"),
    },
    metadata: {
      name: "birmel-pinchtab-token",
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
      // Reserve the baseline while bounding bursts independently.
      resources: {
        cpu: {
          request: Cpu.millis(50),
        },
        memory: {
          request: Size.mebibytes(768),
          limit: Size.gibibytes(2),
        },
      },
      ports: [{ number: 8080, name: "health" }],
      startup: Probe.fromHttpGet("/live", {
        port: 8080,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromHttpGet("/live", {
        port: 8080,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/ready", {
        port: 8080,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
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

        // Bootstrap for the flag client — these cannot come from a flag.
        FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
        FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
        FLIPT_NAMESPACE: EnvValue.fromValue("birmel"),
        FLIPT_URL: EnvValue.fromValue(
          "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
        ),
        // Provider credentials for the LLM runtime, one key per provider from
        // Birmel's own OpenAI project and Gemini project. Anthropic, when
        // federated, arrives through addAnthropicFederation below instead of
        // a key.
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-openai-api-key-secret",
            onePasswordItem.name,
          ),
          key: "OPENAI_API_KEY",
        }),
        GEMINI_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-gemini-api-key-secret",
            onePasswordItem.name,
          ),
          key: "GEMINI_API_KEY",
        }),
        LLM_MODEL: EnvValue.fromValue("gpt-5.6-sol"),
        LLM_CLASSIFIER_MODEL: EnvValue.fromValue("gpt-5.4-nano"),
        LLM_MEMORY_MODEL: EnvValue.fromValue("gpt-5.4-nano"),
        LLM_EMBEDDING_MODEL: EnvValue.fromValue("text-embedding-3-small"),
        LLM_REASONING_EFFORT: EnvValue.fromValue("medium"),

        // Database paths
        DATABASE_URL: EnvValue.fromValue("file:/app/data/birmel.db"),
        OPS_DATABASE_URL: EnvValue.fromValue("file:/app/data/birmel-ops.db"),
        // The historical /app/data/mastra-memory.db remains on the PVC as a
        // forensic archive. Birmel 3.0 deliberately has no runtime path to it.
        HEALTH_PORT: EnvValue.fromValue("8080"),

        // Telemetry configuration (OpenTelemetry)
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("birmel"),
        OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),

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
        DAILY_POSTS_ENABLED: EnvValue.fromValue("true"),
        WEB_SEARCH_PROVIDER: EnvValue.fromValue("openai"),
        PINCHTAB_BASE_URL: EnvValue.fromValue(
          "http://pinchtab.pinchtab.svc.cluster.local:9867",
        ),
        PINCHTAB_PROFILE: EnvValue.fromValue("birmel"),
        // Token comes from the shared "PinchTab" 1Password item (synced into the
        // birmel namespace via pinchtabCreds), the same item the in-cluster
        // pinchtab service authenticates against.
        PINCHTAB_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "birmel-pinchtab-token-secret",
            pinchtabCreds.name,
          ),
          key: "PINCHTAB_TOKEN",
        }),
      },
    }),
  );

  const sandboxTmp = Volume.fromEmptyDir(
    chart,
    "birmel-code-sandbox-tmp",
    "code-sandbox-tmp",
    { sizeLimit: Size.mebibytes(64) },
  );
  deployment.addContainer(
    withCommonProps({
      name: "code-sandbox",
      image: `ghcr.io/shepherdjerred/birmel:${versions["shepherdjerred/birmel"]}`,
      command: ["tini", "-s", "--", "bun", "src/sandbox/server.ts"],
      securityContext: {
        user: 0,
        group: 0,
        ensureNonRoot: false,
        privileged: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: {
          drop: [Capability.ALL],
          add: [
            Capability.CHOWN,
            Capability.DAC_OVERRIDE,
            Capability.FOWNER,
            Capability.KILL,
            Capability.SETGID,
            Capability.SETPCAP,
            Capability.SETUID,
          ],
        },
      },
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
        memory: {
          request: Size.mebibytes(256),
          // Descendant creation is blocked per run, so two concurrent Bun
          // snippets can each reach only their single 1 GiB address space.
          // Leave another 512 MiB for the broker and cleanup.
          limit: Size.mebibytes(2560),
        },
      },
      startup: Probe.fromCommand(
        [
          "bun",
          "-e",
          "const r=await fetch('http://127.0.0.1:8090/health');process.exit(r.ok?0:1)",
        ],
        { periodSeconds: Duration.seconds(5), failureThreshold: 12 },
      ),
      liveness: Probe.fromCommand(
        [
          "bun",
          "-e",
          "const r=await fetch('http://127.0.0.1:8090/health');process.exit(r.ok?0:1)",
        ],
        { periodSeconds: Duration.seconds(30), failureThreshold: 3 },
      ),
      readiness: Probe.fromCommand(
        [
          "bun",
          "-e",
          "const r=await fetch('http://127.0.0.1:8090/health');process.exit(r.ok?0:1)",
        ],
        { periodSeconds: Duration.seconds(10), failureThreshold: 3 },
      ),
      volumeMounts: [{ path: "/tmp/birmel-sandbox", volume: sandboxTmp }],
    }),
  );

  addAnthropicFederation(deployment, { workload: "birmel-prod" });
  setRevisionHistoryLimit(deployment);

  const healthService = new Service(chart, "birmel-health-service", {
    metadata: { labels: { app: "birmel-health" } },
    selector: deployment,
    ports: [{ port: 8080, name: "metrics" }],
  });
  createServiceMonitor(chart, {
    name: "birmel",
    matchLabels: { app: "birmel-health" },
    port: "metrics",
  });

  return { deployment, healthService };
}
