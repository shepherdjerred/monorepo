import { Duration, Size, type Chart } from "cdk8s";
import {
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  Probe,
  SeccompProfileType,
  Service,
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

/** Prepare the replacement edge without claiming live ports or hostnames. */
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
      // The operator copies and verifies the existing ACME state before releasing
      // this temporary gate. No certificate management runs against an empty PVC.
      command: ["/bin/sh", "-ec"],
      args: [
        "until test -f /data/.arcade-edge-migration-ready; do sleep 1; done; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
      ],
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
      startup: Probe.fromHttpGet("/healthz", {
        port: 8082,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 120,
      }),
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
  new Service(chart, "edge-bootstrap", {
    selector: deployment,
    ports: [{ name: "http", port: 8082, targetPort: 8082 }],
  });
  // Internal HTTPS makes certificate validation possible before NodePort handover.
  new Service(chart, "edge-direct", {
    selector: deployment,
    ports: [
      { name: "http", port: 80, targetPort: 8080 },
      { name: "https", port: 443, targetPort: 8443 },
    ],
  });
  new Service(chart, "legacy-redirects", {
    selector: deployment,
    ports: [{ name: "http", port: 8081, targetPort: 8081 }],
  });
}
