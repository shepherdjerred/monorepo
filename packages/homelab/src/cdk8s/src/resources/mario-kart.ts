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
import { ApiObject, JsonPatch, Size } from "cdk8s";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
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

  // Leaderboard SQLite DB. Separate from `saves` on purpose: wiping the
  // emulator's mempak/eeprom saves to reset game state must not destroy the
  // recorded race history. Velero backs it up automatically (<200 GiB).
  const dataVolume = new ZfsNvmeVolume(chart, "mario-kart-data-volume", {
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
        // VAAPI hardware H.264 encoding on the Intel iGPU (requested below). The
        // app reads STREAM_HARDWARE_ACCELERATION/VAAPI_DEVICE; ffmpeg reads
        // LIBVA_DRIVER_NAME. Falls back to software libx264 if the device is absent.
        STREAM_HARDWARE_ACCELERATION: EnvValue.fromValue("true"),
        VAAPI_DEVICE: EnvValue.fromValue("/dev/dri/renderD128"),
        LIBVA_DRIVER_NAME: EnvValue.fromValue("iHD"),
        // OTLP traces → Tempo; frame metrics are scraped from /metrics.
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("discord-plays-mario-kart"),
        OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),
        // Leaderboard SQLite DB on the persistent data volume (overrides the
        // config's relative db_path). The image entrypoint runs `prisma db
        // push` against this before start.
        DATABASE_PATH: EnvValue.fromValue(`${APP_ROOT}/data/leaderboard.db`),
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        user: 1000,
        group: 1000,
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      // Software RDP is CPU-heavy and there's no GPU on the node — give it burst room
      // via the limit. 30d peak is ~900m, so the guaranteed request stays modest.
      resources: {
        cpu: {
          request: Cpu.millis(1000),
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
          path: `${APP_ROOT}/data`,
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "mario-kart-data-pvc",
            dataVolume.claim,
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

  // Request the Intel iGPU so ffmpeg can VAAPI hardware-encode (frees CPU the
  // angrylion software RDP needs). The intel-device-plugin mounts /dev/dri into
  // the pod; non-root UID 1000 works. cdk8s has no GPU field, so patch it in.
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add(
      "/spec/template/spec/containers/0/resources/limits/gpu.intel.com~1i915",
      1,
    ),
  );

  const uiService = new Service(chart, "ui-service", {
    metadata: {
      labels: {
        app: "mario-kart",
      },
    },
    selector: deployment,
    ports: [{ port: WEB_PORT, name: "ui" }],
  });

  // Scrape the frame-loop + process metrics exposed at /metrics on the web port.
  createServiceMonitor(chart, {
    name: "mario-kart",
    port: "ui",
    path: "/metrics",
    namespace: "mario-kart",
    matchLabels: { app: "mario-kart" },
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
