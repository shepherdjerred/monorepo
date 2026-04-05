import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Service,
} from "cdk8s-plus-31";
import type { Service as ServiceType } from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type CreateTemporalUiDeploymentProps = {
  serverService: ServiceType;
};

export function createTemporalUiDeployment(
  chart: Chart,
  props: CreateTemporalUiDeploymentProps,
) {
  const UID = 1000;
  const GID = 1000;

  const deployment = new Deployment(chart, "temporal-ui", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    podMetadata: {
      labels: {
        app: "temporal-ui",
      },
    },
  });

  deployment.addContainer(
    withCommonProps({
      name: "temporal-ui",
      image: `temporalio/ui:${versions["temporalio/ui"]}`,
      ports: [{ name: "http", number: 8080 }],
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverService.name}:7233`),
        TEMPORAL_UI_PORT: EnvValue.fromValue("8080"),
        TEMPORAL_CORS_ORIGINS: EnvValue.fromValue(
          "https://temporal-ui.tailnet-1a49.ts.net,https://temporal.sjer.red",
        ),
      },
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(250),
        },
        memory: {
          request: Size.mebibytes(64),
          limit: Size.mebibytes(256),
        },
      },
      liveness: Probe.fromTcpSocket({
        port: 8080,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromTcpSocket({
        port: 8080,
        initialDelaySeconds: Duration.seconds(5),
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
  });

  createCloudflareTunnelBinding(chart, "temporal-ui-cf-tunnel", {
    serviceName: service.name,
    subdomain: "temporal",
  });

  return { deployment, service };
}
