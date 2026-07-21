import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Capability,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Protocol,
  SeccompProfileType,
  Secret,
  Service,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const SHELFBRIDGE_PORT = 8787;

/**
 * ShelfBridge — Torznab bridge for direct-download book sources (LibGen,
 * Anna's Archive, Z-Library). Registered directly in Bindery as a Torznab
 * indexer (one-time UI step; see the operator guide) so Bindery searches hit
 * shadow libraries alongside Prowlarr indexers; grabs come back as webseed
 * .torrents that qBittorrent downloads through this service's proxy.
 *
 * Note: Prowlarr registration via tofu was the original plan but was dropped
 * because the devopsarr/prowlarr provider has no generic Torznab resource.
 *
 * PUBLIC_BASE_URL must resolve from inside the qBittorrent pod (gluetun
 * netns) — the cluster Service DNS name, not a Tailscale name. No ingress:
 * the only consumers are in-namespace (Bindery API queries, qBit webseeds).
 *
 * Z-Library is enabled anonymously (no ZLIB_EMAIL/PASSWORD) — returns
 * anonymous-tier results; wire creds later by adding envs + 1Password fields.
 */
export function createShelfbridgeDeployment(chart: Chart) {
  const shelfbridgeItem = new OnePasswordItem(chart, "shelfbridge-item", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/kdre4uvjpjeyaccfhrxfvs5rqy",
    },
  });

  const deployment = new Deployment(chart, "shelfbridge", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      // 65532 = the nonroot user baked into the image (USER 65532:65532).
      user: 65_532,
      group: 65_532,
      ensureNonRoot: true,
    },
    metadata: {
      labels: { app: "shelfbridge" },
    },
    podMetadata: {
      labels: { app: "shelfbridge" },
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/shelfbridge:${versions["shepherdjerred/shelfbridge"]}`,
      ports: [
        { number: SHELFBRIDGE_PORT, name: "http", protocol: Protocol.TCP },
      ],
      securityContext: {
        user: 65_532,
        group: 65_532,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      envVariables: {
        API_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "shelfbridge-api-key",
            shelfbridgeItem.name,
          ),
          key: "API_KEY",
        }),
        LISTEN_ADDR: EnvValue.fromValue(`:${String(SHELFBRIDGE_PORT)}`),
        // Webseed URLs handed to qBittorrent point back at the cluster Service.
        PUBLIC_BASE_URL: EnvValue.fromValue(
          `http://media-shelfbridge-service:${String(SHELFBRIDGE_PORT)}`,
        ),
        WEBSEED_MODE: EnvValue.fromValue("proxy"),
        INDEXER_NAME: EnvValue.fromValue("shelfbridge"),
        SOURCE_LIBGEN: EnvValue.fromValue("true"),
        SOURCE_ANNAS: EnvValue.fromValue("true"),
        SOURCE_ZLIB: EnvValue.fromValue("true"),
      },
      resources: {
        cpu: {
          request: Cpu.millis(25),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(64),
          limit: Size.mebibytes(256),
        },
      },
      startup: Probe.fromHttpGet("/health", {
        port: SHELFBRIDGE_PORT,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 30,
      }),
      liveness: Probe.fromHttpGet("/health", {
        port: SHELFBRIDGE_PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/health", {
        port: SHELFBRIDGE_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  new Service(chart, "shelfbridge-service", {
    selector: deployment,
    ports: [{ port: SHELFBRIDGE_PORT }],
  });
}
