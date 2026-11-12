import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  Capability,
  Cpu,
  EnvValue,
  Probe,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import {
  addAnthropicFederation,
  geminiApiKeyEnv,
} from "@shepherdjerred/homelab/cdk8s/src/misc/llm-provider-credentials.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  dnsEgressRule,
  nsPeer,
  tcp,
  fliptEgress,
  otlpEgress,
  prometheusIngressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  NET_ADMIN_FIREWALL_RESOURCES,
  netAdminFirewallSecurityContext,
} from "@shepherdjerred/homelab/cdk8s/src/misc/net-admin-firewall.ts";
import {
  fliptEnv,
  telemetryEnv,
  bugsinkEnv,
  seaweedfsS3,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { httpProbes } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/kubelet-probes.ts";
import {
  FirstPartyWorker,
  type FirstPartyWorkerInitContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/worker.ts";
import type { FirstPartyContainerSpec } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";

export function createBirmelDeployment(chart: Chart) {
  const worker = new FirstPartyWorker(chart, "birmel-worker", {
    name: "birmel",
    deployment: {
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
    },
    containers: (deployment) => {
      const containers = birmelContainers(chart);
      addAnthropicFederation(deployment, { workload: "birmel-prod" });
      return containers;
    },
    metrics: {
      serviceId: "birmel-health-service",
      app: "birmel-health",
      port: 8080,
      monitorName: "birmel",
    },
    policies: [
      // Birmel exposes no ingress of its own now that the editor OAuth server
      // is gone — only Prometheus reaches in, to scrape health.
      {
        name: "birmel-ingress-netpol",
        selects: "namespace",
        ingress: [
          // Allow Prometheus to scrape the health service metrics, without
          // opening other pod ports to the monitoring namespace.
          prometheusIngressRule([8080]),
        ],
      },
      // Allow egress to DNS, Flipt, the OTLP trace gateway, PinchTab, and external HTTPS
      {
        name: "birmel-egress-netpol",
        selects: "namespace",
        egress: [
          // DNS
          dnsEgressRule(),
          // OTLP trace gateway (alloy-gateway.alloy-gateway.svc.cluster.local:4318)
          otlpEgress(),
          // Flipt evaluation (flipt-flipt-service.flipt.svc.cluster.local:8080)
          fliptEgress(),
          // PinchTab browser automation (pinchtab.pinchtab.svc.cluster.local:9867)
          {
            to: [nsPeer("pinchtab")],
            ports: [tcp(9867)],
          },
          // External HTTPS (Discord, OpenAI, Anthropic, GitHub, and Bugsink via its
          // public bugsink.sjer.red DSN host)
          externalHttpsEgressRule(),
        ],
      },
    ],
  });

  return { deployment: worker.deployment, healthService: worker.service };
}

/**
 * Birmel's containers and the 1Password items and claim they read. The claim
 * is created here rather than through the worker's `data` because the Gemini
 * item renders after it.
 */
function birmelContainers(chart: Chart) {
  const firewallRunVolume = Volume.fromEmptyDir(
    chart,
    "birmel-sandbox-firewall-run",
    "sandbox-firewall-run",
  );
  const init: FirstPartyWorkerInitContainer = {
    name: "install-code-sandbox-firewall",
    image: firstPartyImageRecipe("birmel"),
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
  };

  const onePasswordItem = new OnePasswordItem(chart, "birmel-1p", {
    spec: {
      itemPath: vaultItemPath("w5c27dzybxor3j6dzl7lub2soe"),
    },
  });

  // Mirror the SeaweedFS S3 access credentials (the human-friendly
  // SEAWEEDFS_ACCESS_KEY_ID / SEAWEEDFS_SECRET_ACCESS_KEY pair — same item
  // used by s3-static-sites) into birmel's namespace so the LLM archive can
  // PUT to s3://llm-archive without crossing namespaces.
  const seaweedfsCreds = seaweedfsS3.item(
    chart,
    "birmel-seaweedfs-1p",
    "birmel-seaweedfs-s3-credentials",
  );

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

  const main: FirstPartyContainerSpec = {
    image: firstPartyImageRecipe("birmel"),
    securityContext: {
      readOnlyRootFilesystem: false,
      ensureNonRoot: false,
    },
    // Reserve the baseline while bounding bursts independently. 7d working
    // set (2026-10-31): p95 208 MiB, 14d peak 293 MiB.
    resources: {
      cpu: {
        request: Cpu.millis(50),
      },
      memory: {
        request: Size.mebibytes(224),
        limit: Size.gibibytes(2),
      },
    },
    ports: [{ number: 8080, name: "health" }],
    ...httpProbes(8080, {
      live: "/live",
      ready: "/ready",
      startup: { failureThreshold: 24 },
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
      ...fliptEnv({
        namespace: "birmel",
        environment: "prod",
        order: ["FLIPT_ENVIRONMENT", "FLIPT_NAMESPACE", "FLIPT_URL"],
      }),
      // Provider credentials for the LLM runtime, from Birmel's own OpenAI
      // project and the Gemini key the google stack minted. Anthropic
      // arrives through addAnthropicFederation below instead of a key.
      OPENAI_API_KEY: EnvValue.fromSecretValue({
        secret: Secret.fromSecretName(
          chart,
          "birmel-openai-api-key-secret",
          onePasswordItem.name,
        ),
        key: "OPENAI_API_KEY",
      }),
      GEMINI_API_KEY: geminiApiKeyEnv(chart, "birmel-prod"),
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
      ...telemetryEnv({ serviceName: "birmel", serviceNameFirst: true }),

      ...llmArchiveEnvVars(),
      S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
      S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
      ...seaweedfsS3.credentialsEnv(
        Secret.fromSecretName(
          chart,
          "birmel-aws-access-key-id",
          seaweedfsCreds.name,
        ),
      ),

      // Bugsink error reporting
      ...bugsinkEnv(
        Secret.fromSecretName(
          chart,
          "birmel-bugsink-dsn-secret",
          onePasswordItem.name,
        ),
        {
          environment: "production",
          release: firstPartyImageRecipe("birmel"),
        },
      ),

      // General configuration
      LOG_LEVEL: EnvValue.fromValue("info"),
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
  };

  const sandboxTmp = Volume.fromEmptyDir(
    chart,
    "birmel-code-sandbox-tmp",
    "code-sandbox-tmp",
    { sizeLimit: Size.mebibytes(64) },
  );
  const sidecar: FirstPartyContainerSpec = {
    name: "code-sandbox",
    image: firstPartyImageRecipe("birmel"),
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
        // Idle p95 working set is 13Mi (7d, 2026-10-31); snippet runs burst
        // into the limit.
        request: Size.mebibytes(32),
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
  };

  return { init: [init], main, sidecars: [sidecar] };
}
