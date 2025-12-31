import { Deployment, DeploymentStrategy, Service, Volume } from "cdk8s-plus-31";
import { Chart } from "cdk8s";
import { withCommonProps } from "../../misc/common.ts";
import versions from "../../versions.ts";
import { TunnelBinding, TunnelBindingTunnelRefKind } from "../../../generated/imports/networking.cfargotunnel.com.ts";

export function createWebringDocsDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "webring-docs", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
  });

  // Create emptyDir volumes for nginx writable directories
  const cacheVolume = Volume.fromEmptyDir(chart, "webring-nginx-cache", "nginx-cache");
  const runVolume = Volume.fromEmptyDir(chart, "webring-nginx-run", "nginx-run");

  const container = deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/webring-docs:${versions["shepherdjerred/webring-docs"]}`,
      securityContext: {
        readOnlyRootFilesystem: false,
        user: 101, // nginx user
        group: 101,
      },
      portNumber: 80,
    }),
  );

  // Mount writable directories for nginx running as non-root
  container.mount("/var/cache/nginx", cacheVolume);
  container.mount("/var/run", runVolume);

  const service = new Service(chart, "webring-docs-service", {
    selector: deployment,
    ports: [{ port: 80 }],
  });

  new TunnelBinding(chart, "webring-docs-tunnel-binding", {
    subjects: [
      {
        name: service.name,
        spec: {
          fqdn: "webring.sjer.red",
        },
      },
    ],
    tunnelRef: {
      kind: TunnelBindingTunnelRefKind.CLUSTER_TUNNEL,
      name: "homelab-tunnel",
    },
  });
}
