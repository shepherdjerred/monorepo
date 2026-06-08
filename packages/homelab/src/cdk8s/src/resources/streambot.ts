import type { Chart } from "cdk8s";
import { ApiObject, JsonPatch, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type PersistentVolumeClaim,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const STREAMBOT_UID = 1000;
const STREAMBOT_GID = 1000;

/**
 * First-party streambot (the rewrite in packages/streambot). Discord-only — no web server — so it
 * has no Service/Ingress; it makes outbound Discord connections and streams via the selfbot.
 *
 * Runs in the `media` namespace so it can read-only mount the existing movies/tv libraries
 * (RWO PVCs, same single node as Plex/Jellyfin). yt-dlp + ffmpeg are baked into the image.
 */
export function createStreambotDeployment(
  chart: Chart,
  claims: { movies: PersistentVolumeClaim; tv: PersistentVolumeClaim },
) {
  const onePasswordItem = new OnePasswordItem(chart, "streambot-config", {
    spec: {
      itemPath: vaultItemPath("streambot-config"),
    },
  });
  const secret = Secret.fromSecretName(
    chart,
    "streambot-config-secret",
    onePasswordItem.name,
  );

  const fromSecret = (key: string) => EnvValue.fromSecretValue({ secret, key });

  // Small persistent volume for resume state (current item + playback position + queue). Survives
  // pod restarts so a deploy/crash mid-movie picks up where it left off. RWO + the Recreate strategy
  // below guarantees the old pod detaches before the new one attaches (a rolling update would
  // multi-attach-conflict).
  const stateVolume = new ZfsNvmeVolume(chart, "streambot-state-pvc", {
    storage: Size.gibibytes(1),
  });

  const deployment = new Deployment(chart, "streambot", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: STREAMBOT_GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Bun writes its install cache and ffmpeg writes temp files at runtime.",
      },
    },
  });

  deployment.addContainer(
    withCommonProps({
      name: "streambot",
      image: `ghcr.io/shepherdjerred/streambot:${versions["shepherdjerred/streambot"]}`,
      envVariables: {
        BOT_TOKEN: fromSecret("BOT_TOKEN"),
        TOKEN: fromSecret("TOKEN"),
        GUILD_ID: fromSecret("GUILD_ID"),
        COMMAND_CHANNEL_ID: fromSecret("COMMAND_CHANNEL_ID"),
        VIDEO_CHANNEL_ID: fromSecret("VIDEO_CHANNEL_ID"),
        ADMIN_IDS: fromSecret("ADMIN_IDS"),
        // Optional: enables movie/TV poster art on the now-playing embed for local files. Marked
        // optional so the pod still starts if the field isn't present in the streambot-config item.
        TMDB_API_KEY: EnvValue.fromSecretValue(
          { secret, key: "TMDB_API_KEY" },
          { optional: true },
        ),
        VIDEOS_DIR: EnvValue.fromValue("/data/videos"),
        MEDIA_DIRS: EnvValue.fromValue("/media/movies,/media/tv"),
        // Resume state lives on the persistent volume mounted at /state.
        STATE_DIR: EnvValue.fromValue("/state"),
        STREAM_WIDTH: EnvValue.fromValue("1920"),
        STREAM_HEIGHT: EnvValue.fromValue("1080"),
        STREAM_FPS: EnvValue.fromValue("30"),
        STREAM_BITRATE_KBPS: EnvValue.fromValue("4000"),
        STREAM_HARDWARE_ACCELERATION: EnvValue.fromValue("true"),
        VAAPI_DEVICE: EnvValue.fromValue("/dev/dri/renderD128"),
        // Intel iHD VAAPI driver for QuickSync hardware encoding.
        LIBVA_DRIVER_NAME: EnvValue.fromValue("iHD"),
      },
      securityContext: {
        user: STREAMBOT_UID,
        group: STREAMBOT_GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
      },
      resources: {
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(2000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
      volumeMounts: [
        {
          // Writable scan dir for ad-hoc uploads (the library proper is the RO mounts below).
          path: "/data/videos",
          volume: Volume.fromEmptyDir(
            chart,
            "streambot-videos-volume",
            "streambot-videos",
          ),
        },
        {
          // Writable resume-state volume (current item + position + queue), persisted across restarts.
          path: "/state",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "streambot-state-volume",
            stateVolume.claim,
          ),
        },
        {
          path: "/media/movies",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "streambot-movies-volume",
            claims.movies,
          ),
          readOnly: true,
        },
        {
          path: "/media/tv",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "streambot-tv-volume",
            claims.tv,
          ),
          readOnly: true,
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Request the Intel iGPU so ffmpeg can VAAPI hardware-encode. The intel-device-plugin mounts
  // /dev/dri into the pod; non-root UID 1000 works (same as Jellyfin). The GPU resource patch
  // (scripts/patch.ts) leaves an explicit `1` untouched.
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add(
      "/spec/template/spec/containers/0/resources/limits/gpu.intel.com~1i915",
      1,
    ),
  );
}
