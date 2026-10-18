import { ApiObject, JsonPatch, Size, type Chart } from "cdk8s";
import {
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  Probe,
  SeccompProfileType,
  Service,
  ServiceType,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { arcadeCaddyfile } from "./arcade-caddyfile.ts";
import { caddyEdgeContainerDefaults } from "./caddy-edge-container.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";

export const ARCADE_HTTP_NODE_PORT = 30_080;
export const ARCADE_HTTPS_NODE_PORT = 30_443;

/** Serve Arcade and legacy bookmarks from one namespace-owned edge. */
export function createArcadeEdge(chart: Chart) {
  const defaults = caddyEdgeContainerDefaults();
  const caddyfile = arcadeCaddyfile(
    "arcade-arcade-ui.arcade.svc.cluster.local:8081",
  );
  const config = new ConfigMap(chart, "edge-config", {
    data: { Caddyfile: caddyfile },
  });
  const data = new ZfsNvmeVolume(chart, "arcade-edge-data", {
    storage: Size.gibibytes(1),
  });
  const deployment = new Deployment(chart, "edge", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: 1000 },
  });
  setRevisionHistoryLimit(deployment);
  deployment.podMetadata.addAnnotation(
    "caddyfile-hash",
    new Bun.CryptoHasher("sha256").update(caddyfile).digest("hex"),
  );
  deployment.addContainer(
    withCommonProps({
      name: "caddy",
      // Publication freezes this shared infrastructure dependency into chart bytes.
      image: firstPartyImageRecipe("caddy-s3proxy"),
      ports: [
        { name: "http", number: 8080 },
        { name: "https", number: 8443 },
        { name: "bootstrap", number: 8082 },
        { name: "legacy", number: 8081 },
      ],
      resources: defaults.resources,
      securityContext: {
        ...defaults.securityContext,
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      readiness: Probe.fromHttpGet("/healthz", { port: 8082 }),
      liveness: Probe.fromHttpGet("/healthz", { port: 8082 }),
      volumeMounts: [
        {
          path: "/etc/caddy",
          volume: Volume.fromConfigMap(chart, "edge-config-volume", config),
        },
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "edge-data-volume",
            data.claim,
          ),
        },
        {
          path: "/config",
          volume: Volume.fromEmptyDir(chart, "edge-runtime-config", "runtime"),
        },
      ],
    }),
  );
  const bootstrap = new Service(chart, "edge-bootstrap", {
    selector: deployment,
    ports: [{ name: "http", port: 8082, targetPort: 8082 }],
  });
  const direct = new Service(chart, "edge-direct", {
    type: ServiceType.NODE_PORT,
    selector: deployment,
    ports: [
      {
        name: "http",
        port: 80,
        targetPort: 8080,
        nodePort: ARCADE_HTTP_NODE_PORT,
      },
      {
        name: "https",
        port: 443,
        targetPort: 8443,
        nodePort: ARCADE_HTTPS_NODE_PORT,
      },
    ],
  });
  ApiObject.of(direct).addJsonPatch(
    JsonPatch.add("/spec/externalTrafficPolicy", "Local"),
  );
  const redirects = new Service(chart, "legacy-redirects", {
    selector: deployment,
    ports: [{ name: "http", port: 8081, targetPort: 8081 }],
  });
  new TailscaleIngress(chart, "mariokart-tailscale", {
    service: bootstrap,
    host: "mariokart",
    probePath: "/healthz",
  });
  new TailscaleIngress(chart, "pokebot-tailscale", {
    service: redirects,
    host: "pokebot",
    probePath: "/health",
  });
  createCloudflareTunnelBinding(chart, "mariokart-cf-tunnel", {
    serviceName: bootstrap.name,
    subdomain: "mariokart",
    port: 8082,
    // The canonical binding below probes this shared backend and public origin.
    disableProbe: true,
  });
  // OpenTofu retains public DNS ownership; these bindings provide tunnel recovery.
  createCloudflareTunnelBinding(chart, "arcade-cf-tunnel", {
    serviceName: bootstrap.name,
    subdomain: "arcade",
    port: 8082,
    probePath: "/healthz",
    publicProbePath: "/health",
  });
  createCloudflareTunnelBinding(chart, "pokebot-cf-tunnel", {
    serviceName: redirects.name,
    subdomain: "pokebot",
    port: 8081,
    probePath: "/health",
  });
}
