import type { Chart } from "cdk8s";
import { Duration } from "cdk8s";
import {
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
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { temporalUtilityContainerDefaults } from "./container-defaults.ts";

export type CreateTemporalUiDeploymentProps = {
  serverService: ServiceType;
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

  deployment.addContainer(
    withCommonProps({
      name: "temporal-ui",
      image: `temporalio/ui:${versions["temporalio/ui"]}`,
      ports: [{ name: "http", number: 8080 }],
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(
          `${props.serverService.name}:7233`,
        ),
        TEMPORAL_UI_PORT: EnvValue.fromValue("8080"),
        TEMPORAL_CORS_ORIGINS: EnvValue.fromValue(
          "https://temporal-ui.tailnet-1a49.ts.net",
        ),
      },
      ...temporalUtilityContainerDefaults(),
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

  return { deployment, service };
}
