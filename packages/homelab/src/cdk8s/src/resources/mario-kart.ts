import {
  Cpu,
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

// Headless Discord Plays Mario Kart 64: a patched N64Wasm core (parallel-n64 +
// angrylion software RDP) runs in Bun, renders frames in software, and streams
// to a Discord voice channel (Go-Live) via a selfbot. Up to four players drive
// karts through a thin web UI (virtual controllers). No GPU, desktop, or
// browser. The app runs from the inner-monorepo root
// (/workspace/packages/discord-plays-mario-kart), so config.toml / the n64wasm
// assets / saves / roms resolve relative to that CWD.
const APP_ROOT = "/workspace/packages/discord-plays-mario-kart";
const WEB_PORT = 8081;

export function createMarioKartDeployment(chart: Chart) {
  const GID = 1000;

  const deployment = new Deployment(chart, "mario-kart", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Discord Plays Mario Kart requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Application requires writable filesystem for runtime data",
      },
    },
  });

  // Persists in-game saves (mempak/eeprom/flash written under saves/).
  const saveVolume = new ZfsNvmeVolume(chart, "mario-kart-volume", {
    storage: Size.gibibytes(8),
  });

  // Holds the copyrighted MK64 ROM. NEVER baked into the image or a Secret —
  // copy it in once with `kubectl cp <rom> <pod>:${APP_ROOT}/roms/mariokart64.z64`.
  const romVolume = new ZfsNvmeVolume(chart, "mario-kart-rom-volume", {
    storage: Size.gibibytes(1),
  });

  const item = new OnePasswordItem(chart, "mario-kart-config", {
    spec: {
      // "MK64 Config" — 1Password item with a `config.toml` field (server id,
      // [bot], [stream] + [stream.userbot] selfbot token/ids, [stream.video],
      // [emulator], [web]). Lives in the Homelab (Kubernetes) vault alongside
      // the Pokebot config — see packages/discord-plays-mario-kart/README.md.
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/fcugoc3kohpmfwzfvko4hgysyq",
    },
  });

  const secret = Secret.fromSecretName(
    chart,
    "mario-kart-config-secret",
    item.name,
  );

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/discord-plays-mario-kart:${versions["shepherdjerred/discord-plays-mario-kart"]}`,
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
      // Software RDP is CPU-heavy and there's no GPU on the node — give it room.
      resources: {
        cpu: {
          request: Cpu.millis(3000),
          limit: Cpu.millis(8000),
        },
        memory: {
          request: Size.gibibytes(2),
          limit: Size.gibibytes(4),
        },
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
            "mario-kart-pvc",
            saveVolume.claim,
          ),
        },
        {
          path: `${APP_ROOT}/roms`,
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "mario-kart-rom-pvc",
            romVolume.claim,
          ),
        },
        {
          path: `${APP_ROOT}/config.toml`,
          subPath: "config.toml",
          volume: Volume.fromSecret(chart, "mario-kart-config-volume", secret, {
            items: {
              "config.toml": {
                path: "config.toml",
              },
            },
          }),
        },
        // The app's CWD (APP_ROOT) is owned by root and not writable by the
        // runtime user (uid 1000). The winston File transport (logger.ts)
        // crashes at startup trying to `mkdir logs/`. This writable scratch
        // volume keeps that path writable. Once an image built with the
        // stdout-only logger (Console transport only) is deployed, this mount
        // is harmless and can be removed. Mirrors the pokemon deployment.
        {
          path: `${APP_ROOT}/logs`,
          volume: Volume.fromEmptyDir(
            chart,
            "mario-kart-logs",
            "mario-kart-logs",
          ),
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
    host: "mariokart",
  });

  createCloudflareTunnelBinding(chart, "mariokart-cf-tunnel", {
    serviceName: uiService.name,
    subdomain: "mariokart",
  });
}
