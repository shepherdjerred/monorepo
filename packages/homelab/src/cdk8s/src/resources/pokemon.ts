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
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { peerUserbotIds } from "@shepherdjerred/homelab/cdk8s/src/resources/userbot-ids.ts";

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

  // The synced secret is mounted at APP_ROOT/config.toml below. The backend now uses
  // an on-demand /play model (PR shipping the pokebot-mk64-pool refactor): the
  // emulator boots only when a user runs /play in their voice channel, and saves
  // are keyed per-guild under saves/<guildId>/. Config.toml shape:
  //
  //   [stream.userbot]
  //   id    = "<selfbot user id>"
  //   token = "<selfbot token>"
  //   # The single userbot account that joins voice channels and streams. One
  //   # userbot, one emulator, one game at a time — there's no pool of accounts
  //   # because there's no concurrency to exploit.
  //
  //   state_root_dir = "saves"   # root of per-guild dirs (default "saves")
  //
  // Multi-guild service: same userbot account, just invited into every Discord
  // server you want this deployment to serve.
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

  // Mirror the shared SeaweedFS S3 credentials (same vault item used by
  // s3-static-sites + birmel + scout) into the pokemon namespace so the
  // LLM archive can PUT to s3://llm-archive without crossing namespaces.
  // Field names on the vault item are SEAWEEDFS_*; remapped to AWS_* env
  // vars at the container level below.
  const seaweedfsCreds = new OnePasswordItem(chart, "pokemon-seaweedfs-1p", {
    spec: {
      itemPath: vaultItemPath("vet52jaeh75chsalu6lulugium"),
    },
    metadata: {
      name: "pokemon-seaweedfs-s3-credentials",
    },
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/discord-plays-pokemon:${versions["shepherdjerred/discord-plays-pokemon"]}`,
      envVariables: {
        NODE_ENV: EnvValue.fromValue("production"),
        // Peer userbot Discord user IDs (Glitter Kart + Streambot) so the channel-handler
        // excludes them from the "real viewers" count and leaves an otherwise-empty VC.
        // Sourced from the canonical map in resources/userbot-ids.ts.
        PEER_USERBOT_IDS: EnvValue.fromValue(peerUserbotIds("pokemon")),
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
        // Codex goal-mode auth. The app accepts CODEX_ACCESS_TOKEN (OAuth),
        // CODEX_API_KEY / OPENAI_API_KEY (direct API, interchangeable via
        // `CODEX_API_KEY ?? OPENAI_API_KEY`), or a mounted auth.json — any one
        // suffices. We use OPENAI_API_KEY; it's wired as the single required
        // secret (no optional secrets). To switch auth methods, swap this ref.
        OPENAI_API_KEY: EnvValue.fromSecretValue({
          secret,
          key: "OPENAI_API_KEY",
        }),
        // LLM observability: every Codex goal turn, tool call, and screenshot
        // gets archived to SeaweedFS by the LlmArchiveSpanProcessor wired in
        // observability/tracing.ts. SeaweedFS S3 creds come from the shared
        // seaweedfs-s3-credentials 1P item (same pattern as birmel + scout).
        // Vault item exposes the keys as SEAWEEDFS_*; we remap to AWS_*.
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "pokemon-aws-access-key-id",
            seaweedfsCreds.name,
          ),
          key: "SEAWEEDFS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "pokemon-aws-secret-access-key",
            seaweedfsCreds.name,
          ),
          key: "SEAWEEDFS_SECRET_ACCESS_KEY",
        }),
        AWS_ENDPOINT_URL: EnvValue.fromValue(
          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        ),
        S3_ENDPOINT: EnvValue.fromValue(
          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        ),
        S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
        AWS_REGION: EnvValue.fromValue("us-east-1"),
        ...llmArchiveEnvVars(),
        LLM_ARCHIVE_S3_PREFIX: EnvValue.fromValue(
          "goals/discord-plays-pokemon",
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
        // Goal mode (`/goal`) writes a `pokemonctl` wrapper into
        // ${APP_ROOT}/.pokemon-goal-bin at runtime (GoalManager.prepareRuntimeTools),
        // but APP_ROOT is root-owned and the pod runs as uid 1000 — a direct write
        // there fails with EACCES. Mount a writable scratch volume so the Codex goal
        // loop can bootstrap its helper. (screenshot_dir/state_path are pointed at the
        // writable saves/ PVC via config.toml instead.)
        {
          path: `${APP_ROOT}/.pokemon-goal-bin`,
          volume: Volume.fromEmptyDir(
            chart,
            "pokemon-goal-bin",
            "pokemon-goal-bin",
          ),
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
    port: WEB_PORT,
  });
}
