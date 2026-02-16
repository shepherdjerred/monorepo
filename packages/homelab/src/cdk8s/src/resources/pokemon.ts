import {
  Deployment,
  DeploymentStrategy,
  EmptyDirMedium,
  EnvValue,
  Protocol,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { ApiObject, Chart, JsonPatch, Size } from "cdk8s";
import { withCommonProps } from "../misc/common.ts";
import { ZfsNvmeVolume } from "../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../misc/cloudflare-tunnel.ts";
import { OnePasswordItem } from "../../generated/imports/onepassword.com.ts";
import versions from "../versions.ts";

export function createPokemonDeployment(chart: Chart) {
  const GID = 1000;

  const deployment = new Deployment(chart, "pokemon", {
    replicas: 0,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root": "Discord Plays Pokemon requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Application requires writable filesystem for runtime data",
      },
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "pokemon-volume", {
    storage: Size.gibibytes(8),
  });
  const romVolume = new ZfsNvmeVolume(chart, "pokemon-rom-volume", {
    storage: Size.gibibytes(8),
  });

  const item = new OnePasswordItem(chart, "pokemon-config", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/hwyhh64dyu3s7w37q7oj7r4qn4",
    },
  });

  const secret = Secret.fromSecretName(chart, "pokemon-config-secret", item.name);

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/discord-plays-pokemon:${versions["shepherdjerred/discord-plays-pokemon"]}`,
      envVariables: {
        SIZEW: EnvValue.fromValue("1920"),
        SIZEH: EnvValue.fromValue("1080"),
        REFRESH: EnvValue.fromValue("60"),
        PASSWD: EnvValue.fromSecretValue({
          secret,
          key: "password",
        }),
        BASIC_AUTH_PASSWORD: EnvValue.fromSecretValue({
          secret,
          key: "password",
        }),
        SELKIES_ENCODER: EnvValue.fromValue("vah264enc"),
        KASMVNC_ENABLE: EnvValue.fromValue("true"),
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        user: 1000,
        group: 1000,
        // GPU is passed via gpu.intel.com/i915 resource limit, not privileged mode
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      ports: [
        {
          name: "selkies",
          number: 8080,
          protocol: Protocol.TCP,
        },
        {
          name: "ui",
          number: 8181,
          protocol: Protocol.TCP,
        },
      ],

      volumeMounts: [
        {
          path: "/home/ubuntu/Downloads",
          volume: Volume.fromPersistentVolumeClaim(chart, "pokemon-pvc", localPathVolume.claim),
        },
        {
          path: "/home/ubuntu/config.toml",
          subPath: "config.toml",
          volume: Volume.fromSecret(chart, "pokemon-config-volume", secret, {
            items: {
              "config.toml": {
                path: "config.toml",
              },
            },
          }),
        },
        {
          path: `/home/ubuntu/packages/frontend/dist/roms`,
          volume: Volume.fromPersistentVolumeClaim(chart, "pokemon-rom-pvc", romVolume.claim),
        },
        {
          path: "/dev/shm",
          volume: Volume.fromEmptyDir(chart, "shm-volume", "shm", {
            medium: EmptyDirMedium.MEMORY,
            sizeLimit: Size.gibibytes(8),
          }),
        },
      ],
    }),
  );

  const selkiesService = new Service(chart, "selkies-service", {
    selector: deployment,
    ports: [{ port: 8080 }],
  });

  new TailscaleIngress(chart, "selkies-tailscale-ingress", {
    service: selkiesService,
    host: "selkies",
  });

  const uiService = new Service(chart, "ui-service", {
    selector: deployment,
    ports: [{ port: 8181 }],
  });

  new TailscaleIngress(chart, "ui-tailscale-ingress", {
    service: uiService,
    host: "pokebot",
    funnel: true,
  });

  createCloudflareTunnelBinding(chart, "pokebot-cf-tunnel", {
    serviceName: uiService.name,
    subdomain: "pokebot",
  });

  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/containers/0/resources", {
      limits: {
        "gpu.intel.com/i915": 1,
      },
    }),
  );
}
