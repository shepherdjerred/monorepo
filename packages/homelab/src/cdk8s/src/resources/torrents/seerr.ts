import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
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
} from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { setRevisionHistoryLimit } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const SEERR_PORT = 5055;

export function createSeerrDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "seerr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      user: 1000,
      group: 1000,
      fsGroup: 1000,
      fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH,
      ensureNonRoot: true,
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "overseerr-pvc", {
    storage: Size.gibibytes(8),
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/seerr-team/seerr:${versions["seerr-team/seerr"]}`,
      ports: [{ number: SEERR_PORT, name: "http", protocol: Protocol.TCP }],
      envVariables: {
        LOG_LEVEL: EnvValue.fromValue("info"),
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
          path: "/app/config",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "seerr-config-volume",
            localPathVolume.claim,
          ),
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.mebibytes(768),
        },
      },
      startup: Probe.fromHttpGet("/api/v1/settings/public", {
        port: SEERR_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 30,
      }),
      liveness: Probe.fromHttpGet("/api/v1/settings/public", {
        port: SEERR_PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/api/v1/settings/public", {
        port: SEERR_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "seerr-service", {
    selector: deployment,
    ports: [{ port: SEERR_PORT }],
  });

  new TailscaleIngress(chart, "seerr-tailscale-ingress", {
    service,
    host: "seerr",
  });

  createCloudflareTunnelBinding(chart, "seerr-cf-tunnel", {
    serviceName: service.name,
    subdomain: "seerr",
  });

  const overseerrAliasService = new Service(chart, "overseerr-service", {
    selector: deployment,
    ports: [{ port: SEERR_PORT }],
  });

  new TailscaleIngress(chart, "overseerr-tailscale-ingress", {
    service: overseerrAliasService,
    host: "overseerr",
  });

  createCloudflareTunnelBinding(chart, "overseerr-cf-tunnel", {
    serviceName: overseerrAliasService.name,
    subdomain: "overseerr",
  });
}
