import { Chart, Size } from "cdk8s";
import { ConfigMap, Cpu, Deployment, DeploymentStrategy, EnvValue, Secret, Service, Volume } from "cdk8s-plus-31";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { KubeNetworkPolicy } from "../../../generated/imports/k8s.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import { withCommonProps } from "../../misc/common.ts";
import versions from "../../versions.ts";
import { homeassistantSkill, todoistSkill, fastmailSkill, gmailSkill } from "./skills/index.ts";

const OPENCLAW_CONFIG = {
  // Agent defaults - model, workspace, sandbox settings
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-opus-4-5",
      },
      workspace: "/data/workspace",
      sandbox: { mode: "off" }, // k8s pod provides isolation
    },
  },
  gateway: {
    port: 18789,
    mode: "local",
    trustedProxies: ["10.244.0.0/16"], // Trust pod network for Tailscale ingress
    auth: {
      mode: "token",
      token: "${OPENCLAW_GATEWAY_TOKEN}",
      allowTailscale: true, // Accept Tailscale Serve identity headers
    },
    controlUi: {
      allowInsecureAuth: true, // Allow token-only auth without device pairing (behind Tailscale)
    },
  },
  // Discord config - token via env var substitution
  channels: {
    discord: {
      enabled: true,
      token: "${DISCORD_BOT_TOKEN}",
      groupPolicy: "allowlist",
      dm: {
        enabled: true,
        policy: "allowlist",
        allowFrom: ["160509172704739328"],
      },
      guilds: {
        "1092210479755178054": {
          slug: "main",
          requireMention: true,
          channels: {},
        },
      },
    },
  },
  // Skills configuration
  skills: {
    load: {
      extraDirs: ["/data/skills"],
    },
    entries: {
      github: { enabled: true },
      todoist: { enabled: true },
      fastmail: { enabled: true },
      gmail: { enabled: true },
      homeassistant: { enabled: true },
      imessage: { enabled: true },
      obsidian: { enabled: true },
      sonos: { enabled: true },
      browser: { enabled: true },
      weather: { enabled: true },
      canvas: { enabled: true },
      mcporter: { enabled: true },
    },
  },
  // Tool configuration
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "brave",
        apiKey: "${BRAVE_API_KEY}",
        maxResults: 5,
      },
      fetch: {
        enabled: true,
        maxChars: 50000,
        timeoutSeconds: 30,
      },
    },
    deny: [
      "exec", // Broken approval flow + secret exfiltration risk
      "process", // Arbitrary code execution
      "nodes", // Infrastructure access
      "gateway", // Control plane access - could modify own config
      "canvas", // A2UI visual canvas - requires node connection
    ],
  },
};

// mcporter configuration - connects to MCP gateway for external services
const MCPORTER_CONFIG = {
  mcpServers: {
    canvas: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/canvas/sse",
    },
    todoist: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/todoist/sse",
    },
    piazza: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/piazza/sse",
    },
    "home-assistant": {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/home-assistant/sse",
    },
    github: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/github/sse",
    },
    sonos: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/sonos/sse",
    },
    fastmail: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/fastmail/sse",
    },
    weather: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/weather/sse",
    },
    gmail: {
      baseUrl: "http://mcp-gateway.mcp-gateway.svc.cluster.local:9090/gmail/sse",
    },
  },
};

export function createOpenclawDeployment(chart: Chart) {
  const UID = 1000;
  const GID = 1000;

  // 1Password secrets
  const onePasswordItem = new OnePasswordItem(chart, "openclaw-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/openclaw",
    },
    metadata: {
      name: "openclaw",
    },
  });

  const todoistItem = new OnePasswordItem(chart, "todoist-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/todoist",
    },
    metadata: {
      name: "todoist",
    },
  });

  const canvasItem = new OnePasswordItem(chart, "canvas-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/canvas",
    },
    metadata: {
      name: "canvas",
    },
  });

  // ConfigMap with openclaw.json
  const configMap = new ConfigMap(chart, "openclaw-config", {
    metadata: {
      name: "openclaw-config",
    },
    data: {
      "openclaw.json": JSON.stringify(OPENCLAW_CONFIG, null, 2),
    },
  });

  // ConfigMap with skill definitions
  // Keys are flat (no slashes) - init container creates directory structure
  const skillsConfigMap = new ConfigMap(chart, "openclaw-skills", {
    metadata: {
      name: "openclaw-skills",
    },
    data: {
      "homeassistant.md": homeassistantSkill,
      "todoist.md": todoistSkill,
      "fastmail.md": fastmailSkill,
      "gmail.md": gmailSkill,
    },
  });

  // ConfigMap with mcporter configuration for MCP server connections
  const mcporterConfigMap = new ConfigMap(chart, "openclaw-mcporter", {
    metadata: {
      name: "openclaw-mcporter",
    },
    data: {
      "mcporter.json": JSON.stringify(MCPORTER_CONFIG, null, 2),
    },
  });

  // Persistent storage for workspace
  const dataVolume = new ZfsNvmeVolume(chart, "openclaw-data", {
    storage: Size.gibibytes(10),
  });

  // Network Policy - block cloud metadata at minimum
  new KubeNetworkPolicy(chart, "openclaw-netpol", {
    metadata: { name: "openclaw-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "openclaw" } },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0", except: ["169.254.169.254/32"] } }],
        },
      ],
    },
  });

  // Deployment
  const deployment = new Deployment(chart, "openclaw", {
    replicas: 0,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "OpenClaw requires writable filesystem for state and workspace",
      },
    },
    podMetadata: {
      labels: { app: "openclaw" },
    },
  });

  // Create volumes once to share between init and main containers
  const dataVol = Volume.fromPersistentVolumeClaim(chart, "openclaw-data-vol", dataVolume.claim);
  const configVol = Volume.fromConfigMap(chart, "openclaw-config-vol", configMap);
  const skillsVol = Volume.fromConfigMap(chart, "openclaw-skills-vol", skillsConfigMap);
  const mcporterVol = Volume.fromConfigMap(chart, "openclaw-mcporter-vol", mcporterConfigMap);

  // Init container to copy config from ConfigMap to writable location (always overwrites)
  // fsGroup handles ownership, so no chown needed
  deployment.addInitContainer({
    name: "init-config",
    image: `library/busybox:${versions["library/busybox"]}`,
    command: ["sh", "-c", "cp /config-template/openclaw.json /data/openclaw.json"],
    securityContext: {
      user: UID,
      group: GID,
      ensureNonRoot: true,
    },
    volumeMounts: [
      { path: "/data", volume: dataVol },
      { path: "/config-template", volume: configVol },
    ],
  });

  // Init container to copy skills from ConfigMap to writable location
  // Creates directory structure: /data/skills/{name}/SKILL.md from {name}.md files
  deployment.addInitContainer({
    name: "init-skills",
    image: `library/busybox:${versions["library/busybox"]}`,
    command: [
      "sh",
      "-c",
      `for f in /skills-template/*.md; do
        name=$(basename "$f" .md)
        mkdir -p "/data/skills/$name"
        cp "$f" "/data/skills/$name/SKILL.md"
      done`,
    ],
    securityContext: {
      user: UID,
      group: GID,
      ensureNonRoot: true,
    },
    volumeMounts: [
      { path: "/data", volume: dataVol },
      { path: "/skills-template", volume: skillsVol },
    ],
  });

  deployment.addContainer(
    withCommonProps({
      name: "openclaw",
      image: `ghcr.io/shepherdjerred/openclaw:${versions["shepherdjerred/openclaw"]}`,
      args: ["gateway", "--bind", "lan"],
      ports: [{ number: 18789, name: "http" }],
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false, // OpenClaw needs writes
      },
      resources: {
        cpu: { request: Cpu.millis(500), limit: Cpu.millis(2000) },
        memory: { request: Size.gibibytes(1), limit: Size.gibibytes(4) },
      },
      envVariables: {
        OPENCLAW_STATE_DIR: EnvValue.fromValue("/data"),
        ANTHROPIC_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-anthropic-key-secret", onePasswordItem.name),
          key: "anthropic-api-key",
        }),
        DISCORD_BOT_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-discord-token-secret", onePasswordItem.name),
          key: "discord-bot-token",
        }),
        GH_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-gh-token-secret", onePasswordItem.name),
          key: "gh-token",
        }),
        OPENCLAW_GATEWAY_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-gateway-token-secret", onePasswordItem.name),
          key: "gateway-token",
        }),
        TODOIST_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "todoist-secret", todoistItem.name),
          key: "api-key",
        }),
        FASTMAIL_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-fastmail-secret", onePasswordItem.name),
          key: "fastmail-token",
        }),
        GMAIL_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-gmail-secret", onePasswordItem.name),
          key: "gmail-token",
        }),
        HOMEASSISTANT_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-homeassistant-secret", onePasswordItem.name),
          key: "homeassistant-token",
        }),
        CANVAS_API_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "canvas-token-secret", canvasItem.name),
          key: "api-token",
        }),
        CANVAS_BASE_URL: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "canvas-url-secret", canvasItem.name),
          key: "base-url",
        }),
        BRAVE_API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "openclaw-brave-secret", onePasswordItem.name),
          key: "brave-api-key",
        }),
      },
      volumeMounts: [
        { path: "/data", volume: dataVol },
        { path: "/home/node/.mcporter", volume: mcporterVol },
      ],
    }),
  );

  // Service
  const service = new Service(chart, "openclaw-svc", {
    metadata: { name: "openclaw" },
    ports: [{ port: 18789, name: "http" }],
    selector: deployment,
  });

  // Tailscale Ingress
  new TailscaleIngress(chart, "openclaw-ingress", {
    service,
    host: "openclaw",
  });
}
