import { Deployment, DeploymentStrategy, EnvValue, Service } from "cdk8s-plus-31";
import { Chart } from "cdk8s";
import { withCommonProps } from "../../misc/common.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import versions from "../../versions.ts";

export function createRedlibDeployment(chart: Chart) {
  const redlibDeployment = new Deployment(chart, "redlib", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
  });

  redlibDeployment.addContainer(
    withCommonProps({
      image: `quay.io/redlib/redlib:${versions["redlib/redlib"]}`,
      envVariables: {
        REDLIB_DEFAULT_THEME: EnvValue.fromValue("system"),
        REDLIB_DEFAULT_LAYOUT: EnvValue.fromValue("card"),
        REDLIB_DEFAULT_WIDE: EnvValue.fromValue("on"),
        REDLIB_DEFAULT_USE_HLS: EnvValue.fromValue("on"),
        REDLIB_DEFAULT_AUTOPLAY_VIDEOS: EnvValue.fromValue("off"),
      },
      securityContext: {
        readOnlyRootFilesystem: true,
        user: 1000,
        group: 1000,
      },
      portNumber: 8080,
    }),
  );

  const service = new Service(chart, "redlib-service", {
    selector: redlibDeployment,
    ports: [{ port: 8080 }],
  });

  new TailscaleIngress(chart, "redlib-tailscale-ingress", {
    service,
    host: "redlib",
  });
}
