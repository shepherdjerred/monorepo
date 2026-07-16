import {
  Capability,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  FsGroupChangePolicy,
  Probe,
  Protocol,
  SeccompProfileType,
  Service,
  Volume,
  type PersistentVolumeClaim,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { ApiObject, Duration, JsonPatch, Size } from "cdk8s";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { setRevisionHistoryLimit } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const JELLYFIN_PORT = 8096;

export function createJellyfinDeployment(
  chart: Chart,
  claims: {
    tv: PersistentVolumeClaim;
    movies: PersistentVolumeClaim;
  },
) {
  const deployment = new Deployment(chart, "jellyfin", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      user: 1000,
      group: 1000,
      fsGroup: 1000,
      fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH,
      ensureNonRoot: true,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Jellyfin writes runtime data outside mounted config/cache during startup",
      },
    },
  });

  const configVolume = new ZfsNvmeVolume(chart, "jellyfin-config-pvc", {
    storage: Size.gibibytes(16),
  });
  const cacheVolume = new ZfsNvmeVolume(chart, "jellyfin-cache-pvc", {
    storage: Size.gibibytes(32),
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/jellyfin/jellyfin:${versions["jellyfin/jellyfin"]}`,
      ports: [{ number: JELLYFIN_PORT, name: "http", protocol: Protocol.TCP }],
      envVariables: {
        JELLYFIN_PublishedServerUrl: EnvValue.fromValue(
          "https://jellyfin.sjer.red",
        ),
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "jellyfin-config-volume",
            configVolume.claim,
          ),
        },
        {
          path: "/cache",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "jellyfin-cache-volume",
            cacheVolume.claim,
          ),
        },
        {
          path: "/media/tv",
          readOnly: true,
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "jellyfin-tv-volume",
            claims.tv,
          ),
        },
        {
          path: "/media/movies",
          readOnly: true,
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "jellyfin-movies-volume",
            claims.movies,
          ),
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(2000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(4),
        },
      },
      startup: Probe.fromHttpGet("/health", {
        port: JELLYFIN_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 30,
      }),
      liveness: Probe.fromHttpGet("/health", {
        port: JELLYFIN_PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/health", {
        port: JELLYFIN_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "jellyfin-service", {
    selector: deployment,
    ports: [{ port: JELLYFIN_PORT }],
  });

  new TailscaleIngress(chart, "jellyfin-tailscale-ingress", {
    service,
    host: "jellyfin",
  });

  createCloudflareTunnelBinding(chart, "jellyfin-cf-tunnel", {
    serviceName: service.name,
    subdomain: "jellyfin",
    port: JELLYFIN_PORT,
  });

  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add(
      "/spec/template/spec/containers/0/resources/limits/gpu.intel.com~1i915",
      1,
    ),
  );
}
