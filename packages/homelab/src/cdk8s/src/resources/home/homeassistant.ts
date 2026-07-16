import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  Protocol,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { ApiObject, JsonPatch, Size } from "cdk8s";
import {
  ROOT_GID,
  ROOT_UID,
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  createHaCustomComponentInitContainer,
  createPruneStaleComponentsInitContainer,
  HA_CUSTOM_COMPONENTS,
} from "@shepherdjerred/homelab/cdk8s/src/resources/home/ha-custom-components.ts";
import { Glob } from "bun";

export async function createHomeAssistantDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "homeassistant", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/host-network":
          "Required for mDNS and local network device discovery",
        "ignore-check.kube-linter.io/run-as-non-root":
          "Home Assistant requires root for hardware access",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Home Assistant requires writable filesystem for runtime data",
      },
    },
  });

  const claim = new ZfsNvmeVolume(chart, "homeassistant-pvc", {
    storage: Size.gibibytes(64),
  });

  const volume = Volume.fromPersistentVolumeClaim(
    chart,
    "homeassistant-volume",
    claim.claim,
  );

  const glob = new Glob("../../config/homeassistant/*");
  const files: string[] = [];
  for await (const entry of glob.scan("config/homeassistant")) {
    const name = entry.split("/").pop() ?? entry;
    if (name) {
      files.push(name);
    }
  }

  const config = new ConfigMap(chart, "ha-cm");
  config.addDirectory(`${import.meta.dir}/../../../config/homeassistant`);
  const configVolume = Volume.fromConfigMap(chart, "ha-cm-volume", config);

  // Every HA custom_components/www-community entry on this PVC is pinned in
  // git (see ha-custom-components.ts) — nothing installs or updates through
  // HACS anymore. The prune container removes HACS itself and anything not
  // in HA_CUSTOM_COMPONENTS, so undeclared state can't silently persist.
  for (const spec of HA_CUSTOM_COMPONENTS) {
    deployment.addInitContainer({
      ...(await createHaCustomComponentInitContainer(spec)),
      volumeMounts: [{ path: "/config", volume }],
    });
  }
  deployment.addInitContainer({
    ...createPruneStaleComponentsInitContainer(HA_CUSTOM_COMPONENTS),
    volumeMounts: [{ path: "/config", volume }],
  });

  deployment.addContainer(
    withCommonProps({
      securityContext: {
        ensureNonRoot: false,
        user: ROOT_UID,
        group: ROOT_GID,
        // HA runs as root with a writable rootfs, but is NOT privileged: it
        // mounts no host devices (no GPU/USB/serial passthrough). Dropping
        // privileged removes blanket host /dev access. Verified live: pod
        // boots, HTTP 200, no device/permission errors.
        readOnlyRootFilesystem: false,
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      image: `ghcr.io/home-assistant/home-assistant:${versions["home-assistant/home-assistant"]}`,
      ports: [
        {
          name: "port-8123-web",
          number: 8123,
          protocol: Protocol.TCP,
        },
      ],
      volumeMounts: [
        {
          path: "/config",
          volume,
        },
        ...files.map((file) => {
          return {
            path: `/config/${file}`,
            subPath: file,
            volume: configVolume,
          };
        }),
      ],
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(2000),
        },
        // 30d working-set peak is ~1.1Gi; request reflects steady state.
        memory: {
          request: Size.gibibytes(1),
          limit: Size.gibibytes(2),
        },
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  // this simplifies mDNS
  // TODO: remove host networking -- might not be possible with Talos
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/hostNetwork", true),
  );

  const service = new Service(chart, "homeassistant-service", {
    selector: deployment,
    ports: [{ port: 8123 }],
  });

  new TailscaleIngress(chart, "homeassistant-tailscale-ingress", {
    service,
    host: "homeassistant",
  });

  createCloudflareTunnelBinding(chart, "homeassistant-cf-tunnel", {
    serviceName: service.name,
    subdomain: "homeassistant",
    port: 8123,
  });
}
