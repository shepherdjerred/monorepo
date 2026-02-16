import { ConfigMap, Cpu, Deployment, DeploymentStrategy, Protocol, Service, Volume } from "cdk8s-plus-31";
import { ApiObject, Chart, JsonPatch, Size } from "cdk8s";
import { ROOT_GID, ROOT_UID, withCommonProps } from "../../misc/common.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../../misc/cloudflare-tunnel.ts";
import versions from "../../versions.ts";
import { Glob } from "bun";

export async function createHomeAssistantDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "homeassistant", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/privileged-container": "Required for USB device and hardware access",
        "ignore-check.kube-linter.io/privilege-escalation-container": "Required when privileged is true",
        "ignore-check.kube-linter.io/host-network": "Required for mDNS and local network device discovery",
        "ignore-check.kube-linter.io/run-as-non-root": "Home Assistant requires root for hardware access",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Home Assistant requires writable filesystem for runtime data",
      },
    },
  });

  const claim = new ZfsNvmeVolume(chart, "homeassistant-pvc", {
    storage: Size.gibibytes(64),
  });

  const volume = Volume.fromPersistentVolumeClaim(chart, "homeassistant-volume", claim.claim);

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

  deployment.addContainer(
    withCommonProps({
      securityContext: {
        ensureNonRoot: false,
        user: ROOT_UID,
        group: ROOT_GID,
        // required
        readOnlyRootFilesystem: false,
        privileged: true,
        allowPrivilegeEscalation: true,
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
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
    }),
  );

  // this simplifies mDNS
  // TODO: remove host networking -- might not be possible with Talos
  ApiObject.of(deployment).addJsonPatch(JsonPatch.add("/spec/template/spec/hostNetwork", true));

  const service = new Service(chart, "homeassistant-service", {
    selector: deployment,
    ports: [{ port: 8123 }],
  });

  new TailscaleIngress(chart, "homeassistant-tailscale-ingress", {
    service,
    host: "homeassistant",
    funnel: true,
  });

  createCloudflareTunnelBinding(chart, "homeassistant-cf-tunnel", {
    serviceName: service.name,
    subdomain: "homeassistant",
  });
}
