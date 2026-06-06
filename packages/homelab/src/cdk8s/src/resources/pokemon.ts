import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Protocol,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// Headless Discord Plays Pokemon: pokeemerald-wasm runs in Bun, renders frames
// in software, and streams to a Discord voice channel via the voice UDP path.
// No GPU, desktop, Firefox, or Selkies — just a plain Bun service. The app runs
// from the inner-monorepo root (/workspace/packages/discord-plays-pokemon), so
// config.toml / wasm / saves resolve relative to that CWD.
const APP_ROOT = "/workspace/packages/discord-plays-pokemon";
const WEB_PORT = 8081;

export function createPokemonDeployment(chart: Chart) {
  const GID = 1000;

  const deployment = new Deployment(chart, "pokemon", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Discord Plays Pokemon requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Application requires writable filesystem for runtime data",
      },
    },
  });

  // Persists the flash save (save_path = "saves/pokeemerald.flash").
  const saveVolume = new ZfsNvmeVolume(chart, "pokemon-volume", {
    storage: Size.gibibytes(8),
  });

  const item = new OnePasswordItem(chart, "pokemon-config", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/hwyhh64dyu3s7w37q7oj7r4qn4",
    },
  });

  const secret = Secret.fromSecretName(
    chart,
    "pokemon-config-secret",
    item.name,
  );

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/discord-plays-pokemon:${versions["shepherdjerred/discord-plays-pokemon"]}`,
      envVariables: {
        NODE_ENV: EnvValue.fromValue("production"),
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        user: 1000,
        group: 1000,
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      ports: [
        {
          name: "ui",
          number: WEB_PORT,
          protocol: Protocol.TCP,
        },
      ],
      volumeMounts: [
        {
          path: `${APP_ROOT}/saves`,
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "pokemon-pvc",
            saveVolume.claim,
          ),
        },
        {
          path: `${APP_ROOT}/config.toml`,
          subPath: "config.toml",
          volume: Volume.fromSecret(chart, "pokemon-config-volume", secret, {
            items: {
              "config.toml": {
                path: "config.toml",
              },
            },
          }),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  const uiService = new Service(chart, "ui-service", {
    selector: deployment,
    ports: [{ port: WEB_PORT }],
  });

  new TailscaleIngress(chart, "ui-tailscale-ingress", {
    service: uiService,
    host: "pokebot",
  });

  createCloudflareTunnelBinding(chart, "pokebot-cf-tunnel", {
    serviceName: uiService.name,
    subdomain: "pokebot",
  });
}
