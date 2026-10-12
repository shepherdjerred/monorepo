import { ApiObject, JsonPatch, Size, type Chart } from "cdk8s";
import {
  Capability,
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  Probe,
  Service,
  ServiceType,
  Volume,
} from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { marioKartCaddyfile } from "./mario-kart-caddyfile.ts";

export const MARIO_KART_HTTP_NODE_PORT = 30_080;
export const MARIO_KART_HTTPS_NODE_PORT = 30_443;

/** Prepare HTTPS while the current Cloudflare-backed hostname remains usable. */
export function createMarioKartDirectIngress(
  chart: Chart,
  upstream: Service,
): Service {
  const caddyfile = marioKartCaddyfile(`${upstream.name}:8081`);
  const config = new ConfigMap(chart, "mario-kart-edge-config", {
    data: { Caddyfile: caddyfile },
  });
  const data = new ZfsNvmeVolume(chart, "mario-kart-edge-data", {
    storage: Size.gibibytes(1),
  });
  const deployment = new Deployment(chart, "mario-kart-edge", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: 1000 },
  });
  setRevisionHistoryLimit(deployment);
  deployment.podMetadata.addAnnotation(
    "caddyfile-hash",
    new Bun.CryptoHasher("sha256").update(caddyfile).digest("hex"),
  );
  const container = deployment.addContainer(
    withCommonProps({
      name: "caddy",
      image: `ghcr.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`,
      ports: [
        { name: "http", number: 8080 },
        { name: "https", number: 8443 },
        { name: "bootstrap", number: 8082 },
      ],
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        capabilities: { drop: [Capability.ALL] },
      },
      readiness: Probe.fromHttpGet("/healthz", { port: 8082 }),
      liveness: Probe.fromHttpGet("/healthz", { port: 8082 }),
    }),
  );
  container.mount(
    "/etc/caddy",
    Volume.fromConfigMap(chart, "mario-kart-edge-config-volume", config),
  );
  container.mount(
    "/data",
    Volume.fromPersistentVolumeClaim(
      chart,
      "mario-kart-edge-data-volume",
      data.claim,
    ),
  );
  container.mount(
    "/config",
    Volume.fromEmptyDir(
      chart,
      "mario-kart-edge-runtime-config",
      "mario-kart-edge-runtime-config",
    ),
  );

  const direct = new Service(chart, "mario-kart-edge-direct", {
    type: ServiceType.NODE_PORT,
    selector: deployment,
    ports: [
      {
        name: "http",
        port: 80,
        targetPort: 8080,
        nodePort: MARIO_KART_HTTP_NODE_PORT,
      },
      {
        name: "https",
        port: 443,
        targetPort: 8443,
        nodePort: MARIO_KART_HTTPS_NODE_PORT,
      },
    ],
  });
  ApiObject.of(direct).addJsonPatch(
    JsonPatch.add("/spec/externalTrafficPolicy", "Local"),
  );

  return new Service(chart, "mario-kart-edge-bootstrap", {
    selector: deployment,
    ports: [{ name: "http", port: 8082, targetPort: 8082 }],
  });
}
