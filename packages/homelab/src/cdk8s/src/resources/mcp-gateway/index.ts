import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { fileURLToPath } from "node:url";
import path from "node:path";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = path.dirname(CURRENT_FILENAME);

// Init-container script: substitute the client auth token (from a Secret) into
// the proxy config so the token never lives in the ConfigMap. Fails closed if
// the token env is missing. The placeholder is a plain identifier (no sed
// escaping needed); generate the token as hex (`openssl rand -hex 32`) so the
// sed replacement is safe.
const RENDER_CONFIG_SCRIPT = [
  "set -eu",
  'if [ -z "${MCP_PROXY_AUTH_TOKEN:-}" ]; then echo "MCP_PROXY_AUTH_TOKEN is required for the mcp-gateway client auth token" >&2; exit 1; fi',
  'sed "s#MCP_PROXY_AUTH_TOKEN_PLACEHOLDER#${MCP_PROXY_AUTH_TOKEN}#g" /config/config.json > /rendered/config.json',
  'echo "rendered mcp-proxy config with client auth token"',
].join("\n");

export async function createMcpGatewayDeployment(chart: Chart) {
  const UID = 65_534;
  const GID = 65_534;

  // Load the mcp-proxy configuration from file.
  const configPath = path.join(CURRENT_DIRNAME, "config.json");
  const configContent = await Bun.file(configPath).text();

  // Create ConfigMap for mcp-proxy configuration
  const mcpProxyConfig = new ConfigMap(chart, "mcp-proxy-config", {
    metadata: {
      name: "mcp-proxy-config",
    },
    data: {
      "config.json": configContent,
    },
  });

  // Shared credential items
  const canvasItem = new OnePasswordItem(chart, "canvas-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/canvas",
    },
    metadata: {
      name: "canvas",
    },
  });

  // Shared credentials (GitHub token, Fastmail token, Gmail token)
  const mcpGatewayCredentials = new OnePasswordItem(
    chart,
    "mcp-gateway-credentials-1p",
    {
      spec: {
        itemPath: vaultItemPath("iixelnobjabehkgxhl3ekacdy4"),
      },
      metadata: {
        name: "mcp-gateway-credentials",
      },
    },
  );

  const deployment = new Deployment(chart, "mcp-gateway", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "MCP Gateway requires writable filesystem for runtime data",
      },
    },
  });

  // Source config (ConfigMap, holds only the placeholder) and the rendered
  // output (emptyDir, holds the real token after the init container runs).
  const configVolume = Volume.fromConfigMap(
    chart,
    "mcp-proxy-config-volume",
    mcpProxyConfig,
  );
  const renderedConfigVolume = Volume.fromEmptyDir(
    chart,
    "mcp-proxy-rendered-config-volume",
    "rendered-config",
  );

  // Render config.json with the client auth token before the proxy starts, so
  // the secret never lives in the ConfigMap. The proxy then requires
  // `Authorization: <token>` from clients (mcpProxy.options.authTokens).
  deployment.addInitContainer(
    withCommonProps({
      name: "render-config",
      image: `library/busybox:${versions["library/busybox"]}`,
      command: ["/bin/sh", "-c"],
      args: [RENDER_CONFIG_SCRIPT],
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
      },
      envVariables: {
        MCP_PROXY_AUTH_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "mcp-proxy-auth-token-secret",
            mcpGatewayCredentials.name,
          ),
          key: "MCP_PROXY_AUTH_TOKEN",
        }),
      },
      volumeMounts: [
        { path: "/config", volume: configVolume, readOnly: true },
        { path: "/rendered", volume: renderedConfigVolume },
      ],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/tbxark/mcp-proxy:${versions["tbxark/mcp-proxy"]}`,
      args: ["--config", "/rendered/config.json"],
      ports: [{ number: 9090, name: "http" }],
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(1),
        },
        cpu: {
          request: Cpu.millis(200),
          limit: Cpu.millis(500),
        },
      },
      liveness: Probe.fromTcpSocket({
        port: 9090,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromTcpSocket({
        port: 9090,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(10),
      }),
      envVariables: {
        // Set HOME to /tmp so npx can write cache files (container runs as nobody with /nonexistent home)
        HOME: EnvValue.fromValue("/tmp"),
        // Canvas configuration (shared credential)
        CANVAS_API_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "canvas-token-secret",
            canvasItem.name,
          ),
          key: "CANVAS_API_TOKEN",
        }),
        CANVAS_BASE_URL: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "canvas-url-secret",
            canvasItem.name,
          ),
          key: "CANVAS_BASE_URL",
        }),
        // GitHub configuration - @modelcontextprotocol/server-github expects GITHUB_TOKEN
        GITHUB_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "github-token-secret",
            mcpGatewayCredentials.name,
          ),
          key: "GH_TOKEN",
        }),
        // Fastmail JMAP configuration
        JMAP_SESSION_URL: EnvValue.fromValue(
          "https://api.fastmail.com/jmap/session",
        ),
        JMAP_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "fastmail-jmap-token-secret",
            mcpGatewayCredentials.name,
          ),
          key: "FASTMAIL_TOKEN",
        }),
        // Gmail IMAP configuration - @automatearmy/email-reader-mcp expects USER_EMAIL and USER_PASS
        USER_EMAIL: EnvValue.fromValue("shepherdjerred@gmail.com"),
        USER_PASS: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "gmail-pass-secret",
            mcpGatewayCredentials.name,
          ),
          key: "GMAIL_TOKEN",
        }),
      },
      volumeMounts: [
        {
          path: "/rendered",
          volume: renderedConfigVolume,
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Create Service for mcp-proxy
  const service = new Service(chart, "mcp-gateway-service", {
    metadata: {
      name: "mcp-gateway",
    },
    selector: deployment,
    ports: [{ port: 9090, name: "http" }],
  });

  // TailscaleIngress for internal access
  new TailscaleIngress(chart, "mcp-gateway-ingress", {
    service: service,
    host: "mcp-gateway",
  });
}
