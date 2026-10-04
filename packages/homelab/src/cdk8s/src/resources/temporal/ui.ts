import type { Chart } from "cdk8s";
import { Duration } from "cdk8s";
import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Service as ServiceType } from "cdk8s-plus-31";
import type { ISecret } from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { authenticatedGatewayContainerDefaults } from "@shepherdjerred/homelab/cdk8s/src/misc/authenticated-gateway-container.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { temporalUtilityContainerDefaults } from "./container-defaults.ts";
import {
  TEMPORAL_UI_GATEWAY_CONFIG,
  TEMPORAL_UI_UPSTREAM_PORT,
} from "./external-auth.ts";

export type CreateTemporalUiDeploymentProps = {
  serverService: ServiceType;
  externalAuthSecret: ISecret;
};

export function createTemporalUiDeployment(
  chart: Chart,
  props: CreateTemporalUiDeploymentProps,
) {
  const GID = 1000;

  const deployment = new Deployment(chart, "temporal-ui", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: { "argocd.argoproj.io/sync-wave": "2" },
    },
    securityContext: {
      fsGroup: GID,
    },
    podMetadata: {
      labels: {
        app: "temporal-ui",
      },
    },
  });
  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "temporal-ui-gateway-tmp",
    "gateway-tmp",
  );

  deployment.addContainer(
    withCommonProps({
      name: "temporal-ui",
      image: `temporalio/ui:${versions["temporalio/ui"]}`,
      ports: [{ name: "upstream", number: TEMPORAL_UI_UPSTREAM_PORT }],
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(
          `${props.serverService.name}:7233`,
        ),
        TEMPORAL_UI_PORT: EnvValue.fromValue(
          TEMPORAL_UI_UPSTREAM_PORT.toString(),
        ),
        TEMPORAL_CORS_ORIGINS: EnvValue.fromValue(
          "https://temporal-ui.tailnet-1a49.ts.net",
        ),
      },
      ...temporalUtilityContainerDefaults(),
      liveness: Probe.fromTcpSocket({
        port: TEMPORAL_UI_UPSTREAM_PORT,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromTcpSocket({
        port: TEMPORAL_UI_UPSTREAM_PORT,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(10),
      }),
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "authenticated-gateway",
      image: `ghcr.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        'printf "%s" "$CADDY_CONFIG" > /tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile',
      ],
      ports: [{ name: "http", number: 8080 }],
      envVariables: {
        CADDY_CONFIG: EnvValue.fromValue(TEMPORAL_UI_GATEWAY_CONFIG),
        TEMPORAL_UI_BASIC_HASH: EnvValue.fromSecretValue({
          secret: props.externalAuthSecret,
          key: "ui-basic-hash",
        }),
      },
      volumeMounts: [{ path: "/tmp", volume: tmpVolume }],
      ...authenticatedGatewayContainerDefaults(),
      liveness: Probe.fromHttpGet("/health", {
        port: 8080,
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromHttpGet("/health", {
        port: 8080,
        periodSeconds: Duration.seconds(10),
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "temporal-ui-service", {
    selector: deployment,
    metadata: {
      labels: { app: "temporal-ui" },
    },
    ports: [{ port: 8080, name: "http" }],
  });

  new TailscaleIngress(chart, "temporal-ui-tailscale-ingress", {
    service,
    host: "temporal-ui",
    probePath: "/health",
  });

  return { deployment, service };
}
