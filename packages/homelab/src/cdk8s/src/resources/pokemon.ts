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
        // VAAPI hardware H.264 encoding on the Intel iGPU (requested below). The
        // app reads STREAM_HARDWARE_ACCELERATION/VAAPI_DEVICE; ffmpeg reads
        // LIBVA_DRIVER_NAME. Falls back to software libx264 if the device is absent.
        STREAM_HARDWARE_ACCELERATION: EnvValue.fromValue("true"),
        VAAPI_DEVICE: EnvValue.fromValue("/dev/dri/renderD128"),
        LIBVA_DRIVER_NAME: EnvValue.fromValue("iHD"),
        // OTLP traces → Tempo; frame metrics are scraped from /metrics.
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("discord-plays-pokemon"),
        OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),
        CODEX_API_KEY: EnvValue.fromSecretValue(
          { secret, key: "CODEX_API_KEY" },
          { optional: true },
        ),
        CODEX_ACCESS_TOKEN: EnvValue.fromSecretValue(
          { secret, key: "CODEX_ACCESS_TOKEN" },
          { optional: true },
        ),
        OPENAI_API_KEY: EnvValue.fromSecretValue(
          { secret, key: "OPENAI_API_KEY" },
          { optional: true },
        ),
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        user: 1000,
        group: 1000,
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      // Single-threaded WASM emulation at ~60fps is CPU-heavy; give it room. The
      // i915 limit is added via JsonPatch below (the cdk8s resources API has no
      // GPU field). The limits block must exist for that patch path to resolve.
      resources: {
        cpu: {
          request: Cpu.millis(1000),
          limit: Cpu.millis(4000),
        },
        memory: {
          request: Size.gibibytes(1),
          limit: Size.gibibytes(2),
        },
      },
      ports: [
        {
          name: "ui",
          number: WEB_PORT,
          protocol: Protocol.TCP,
        },
      ],
      // /metrics is served on the same web server (WEB_PORT); see ServiceMonitor below.
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
        // The app's CWD (APP_ROOT) is owned by root and not writable by the
        // runtime user (uid 1000). Images at/before 2.0.0-3436 use a winston
        // File transport that crashes at startup trying to `mkdir logs/`. This
        // writable scratch volume keeps that path writable. Once an image built
        // with the stdout-only logger (Console transport only) is deployed, this
        // mount is harmless and can be removed.
        {
          path: `${APP_ROOT}/logs`,
          volume: Volume.fromEmptyDir(chart, "pokemon-logs", "pokemon-logs"),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Request the Intel iGPU so ffmpeg can VAAPI hardware-encode. The
  // intel-device-plugin mounts /dev/dri into the pod; non-root UID 1000 works
  // (same as Jellyfin/streambot). cdk8s has no GPU resource field, so patch it in.
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add(
      "/spec/template/spec/containers/0/resources/limits/gpu.intel.com~1i915",
      1,
    ),
  );

  const uiService = new Service(chart, "ui-service", {
    metadata: {
      labels: {
        app: "pokemon",
      },
    },
    selector: deployment,
    ports: [{ port: WEB_PORT, name: "ui" }],
  });

  // Scrape the frame-loop + process metrics exposed at /metrics on the web port.
  createServiceMonitor(chart, {
    name: "pokemon",
    port: "ui",
    path: "/metrics",
    namespace: "pokemon",
    matchLabels: { app: "pokemon" },
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
