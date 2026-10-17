import { Size, type Chart } from "cdk8s";
import {
  Capability,
  ConfigMap,
  Cpu,
  Probe,
  SeccompProfileType,
  Volume,
} from "cdk8s-plus-31";
import {
  createBurstDeployment,
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const CADDYFILE = `{
  admin off
  auto_https off
}
http://:8081 {
  handle /health {
    respond "ok" 200
  }
  handle {
    header Cache-Control "no-store"
    redir https://arcade.sjer.red 307
  }
}
`;

/** Preserve old bookmarks while authentication stays on Arcade's canonical origin. */
export function createPokemonWebRedirect(chart: Chart) {
  const config = new ConfigMap(chart, "web-redirect-config", {
    data: { Caddyfile: CADDYFILE },
  });
  const deployment = createBurstDeployment(chart, "web-redirect", {
    replicas: 1,
    securityContext: { fsGroup: 1000 },
  });
  setRevisionHistoryLimit(deployment);
  deployment.podMetadata.addAnnotation(
    "caddyfile-hash",
    new Bun.CryptoHasher("sha256").update(CADDYFILE).digest("hex"),
  );
  deployment.addContainer(
    withCommonProps({
      image: `docker.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`,
      ports: [{ name: "ui", number: 8081 }],
      securityContext: {
        ensureNonRoot: true,
        user: 1000,
        group: 1000,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(250) },
        memory: { request: Size.mebibytes(32), limit: Size.mebibytes(128) },
      },
      readiness: Probe.fromHttpGet("/health", { port: 8081 }),
      liveness: Probe.fromHttpGet("/health", { port: 8081 }),
      volumeMounts: [
        {
          path: "/etc/caddy",
          volume: Volume.fromConfigMap(
            chart,
            "web-redirect-config-mount",
            config,
          ),
        },
        {
          path: "/config",
          volume: Volume.fromEmptyDir(chart, "web-redirect-runtime", "runtime"),
        },
        {
          path: "/data",
          volume: Volume.fromEmptyDir(chart, "web-redirect-data", "data"),
        },
      ],
    }),
  );
  return deployment;
}
