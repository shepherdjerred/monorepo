import { Chart, Duration, Size } from "cdk8s";
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
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import versions from "../../versions.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import { withCommonProps } from "../../misc/common.ts";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = dirname(CURRENT_FILENAME);

export async function createMcpGatewayDeployment(chart: Chart) {
  const UID = 65534;
  const GID = 65534;

  // Load the mcp-proxy configuration from file
  const configPath = join(CURRENT_DIRNAME, "config.json");
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

  const piazzaItem = new OnePasswordItem(chart, "piazza-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/piazza",
    },
    metadata: {
      name: "piazza",
    },
  });

  // GitHub credentials (shared with openclaw)
  const openclawItem = new OnePasswordItem(chart, "openclaw-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/openclaw",
    },
    metadata: {
      name: "openclaw",
    },
  });

  const deployment = new Deployment(chart, "mcp-gateway", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs": "MCP Gateway requires writable filesystem for runtime data",
      },
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/tbxark/mcp-proxy:${versions["tbxark/mcp-proxy"]}`,
      args: ["--config", "/config/config.json"],
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
          secret: Secret.fromSecretName(chart, "canvas-token-secret", canvasItem.name),
          key: "api-token",
        }),
        CANVAS_BASE_URL: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "canvas-url-secret", canvasItem.name),
          key: "base-url",
        }),
        // Todoist configuration - todoist-mcp expects API_KEY env var
        API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "todoist-secret", todoistItem.name),
          key: "api-key",
        }),
        // Piazza configuration
        PIAZZA_EMAIL: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "piazza-email-secret", piazzaItem.name),
          key: "email",
        }),
        PIAZZA_PASSWORD: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "piazza-password-secret", piazzaItem.name),
          key: "password",
        }),
        PIAZZA_COURSES: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "piazza-courses-secret", piazzaItem.name),
          key: "courses",
        }),
        // GitHub configuration - @modelcontextprotocol/server-github expects GITHUB_TOKEN
        GITHUB_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "github-token-secret", openclawItem.name),
          key: "gh-token",
        }),
        // Fastmail JMAP configuration - token stored in openclaw 1Password item
        JMAP_SESSION_URL: EnvValue.fromValue("https://api.fastmail.com/jmap/session"),
        JMAP_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "fastmail-jmap-token-secret", openclawItem.name),
          key: "fastmail-token",
        }),
        // Gmail IMAP configuration - @automatearmy/email-reader-mcp expects USER_EMAIL and USER_PASS
        USER_EMAIL: EnvValue.fromValue("shepherdjerred@gmail.com"),
        USER_PASS: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "gmail-pass-secret", openclawItem.name),
          key: "gmail-token",
        }),
      },
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromConfigMap(chart, "mcp-proxy-config-volume", mcpProxyConfig),
        },
      ],
    }),
  );

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
