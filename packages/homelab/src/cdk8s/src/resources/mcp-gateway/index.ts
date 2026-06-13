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

// Init-container script: substitute secret-backed tokens (from a Secret) into
// the proxy config so they never live in the ConfigMap. Fails closed if any
// token env is missing. Placeholders are plain identifiers (no sed escaping
// needed): MCP_PROXY_AUTH_TOKEN is the gateway's own client auth token (generate
// as hex, `openssl rand -hex 32`); FASTMAIL_TOKEN is the Bearer token for the
// official Fastmail MCP server (https://api.fastmail.com/mcp, an `fmu1-…` API
// token); HOMEASSISTANT_TOKEN is a Home Assistant long-lived access token used
// as the Bearer for HA's /api/mcp endpoint. None contain sed metacharacters, so
// the `#`-delimited seds are safe.
const RENDER_CONFIG_SCRIPT = [
  "set -eu",
  'if [ -z "${MCP_PROXY_AUTH_TOKEN:-}" ]; then echo "MCP_PROXY_AUTH_TOKEN is required for the mcp-gateway client auth token" >&2; exit 1; fi',
  'if [ -z "${FASTMAIL_TOKEN:-}" ]; then echo "FASTMAIL_TOKEN is required for the Fastmail MCP bearer token" >&2; exit 1; fi',
  'if [ -z "${HOMEASSISTANT_TOKEN:-}" ]; then echo "HOMEASSISTANT_TOKEN is required for the Home Assistant MCP bearer token" >&2; exit 1; fi',
  'sed -e "s#MCP_PROXY_AUTH_TOKEN_PLACEHOLDER#${MCP_PROXY_AUTH_TOKEN}#g" -e "s#FASTMAIL_TOKEN_PLACEHOLDER#${FASTMAIL_TOKEN}#g" -e "s#HOMEASSISTANT_TOKEN_PLACEHOLDER#${HOMEASSISTANT_TOKEN}#g" /config/config.json > /rendered/config.json',
  'echo "rendered mcp-proxy config with client auth + fastmail + home-assistant tokens"',
].join("\n");

export async function createMcpGatewayDeployment(chart: Chart) {
  const UID = 65_534;
  const GID = 65_534;

  // Load the mcp-proxy configuration from file, then substitute the pinned,
  // Renovate-tracked downstream MCP server versions (from versions.ts) at synth
  // time. Secret-backed tokens use *_PLACEHOLDER markers instead and are
  // substituted at runtime by the init container (see RENDER_CONFIG_SCRIPT).
  const configPath = path.join(CURRENT_DIRNAME, "config.json");
  const rawConfig = await Bun.file(configPath).text();
  const configContent = rawConfig
    .replaceAll("CANVAS_MCP_VERSION", versions["@r-huijts/canvas-mcp"])
    .replaceAll(
      "GITHUB_MCP_VERSION",
      versions["@modelcontextprotocol/server-github"],
    )
    .replaceAll(
      "GMAIL_MCP_VERSION",
      versions["@automatearmy/email-reader-mcp"],
    );

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
      // Deliberately BestEffort (no requests/limits) — negligible or
      // non-critical usage; see the 2026-06-12 right-sizing plan.
      resources: {},
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
        // Bearer token for the official Fastmail MCP server, substituted into
        // the rendered config (see RENDER_CONFIG_SCRIPT) so it stays out of the
        // ConfigMap.
        FASTMAIL_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "fastmail-token-init-secret",
            mcpGatewayCredentials.name,
          ),
          key: "FASTMAIL_TOKEN",
        }),
        // Home Assistant long-lived access token, substituted into the rendered
        // config (see RENDER_CONFIG_SCRIPT) as the Bearer for HA's /api/mcp
        // endpoint so it stays out of the ConfigMap.
        HOMEASSISTANT_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "homeassistant-token-init-secret",
            mcpGatewayCredentials.name,
          ),
          key: "HOMEASSISTANT_TOKEN",
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
      image: `ghcr.io/shepherdjerred/mcp-gateway:${versions["shepherdjerred/mcp-gateway"]}`,
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
          request: Size.mebibytes(128),
          limit: Size.gibibytes(1),
        },
        cpu: {
          request: Cpu.millis(50),
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
        // Fastmail now uses the official remote MCP server
        // (https://api.fastmail.com/mcp, a streamable-http client in
        // config.json) authed with a Bearer token rendered into the config by
        // the init container — so no JMAP env vars are needed here.
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
        // Edstem (Ed Discussion) configuration - rob-9/edstem-mcp expects ED_API_TOKEN
        ED_API_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "edstem-api-token-secret",
            mcpGatewayCredentials.name,
          ),
          key: "ED_API_TOKEN",
        }),
        ED_REGION: EnvValue.fromValue("us"),
        // Gradescope configuration - Yuanpeng-Li/gradescope-mcp logs in with account credentials
        GRADESCOPE_EMAIL: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "gradescope-email-secret",
            mcpGatewayCredentials.name,
          ),
          key: "GRADESCOPE_EMAIL",
        }),
        GRADESCOPE_PASSWORD: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "gradescope-password-secret",
            mcpGatewayCredentials.name,
          ),
          key: "GRADESCOPE_PASSWORD",
        }),
        // Discord configuration - mcp-discord expects DISCORD_TOKEN (bot token)
        DISCORD_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "discord-token-secret",
            mcpGatewayCredentials.name,
          ),
          key: "DISCORD_TOKEN",
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
