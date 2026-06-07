import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
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
        VIDEOS_DIR: EnvValue.fromValue("/data/videos"),
        MEDIA_DIRS: EnvValue.fromValue("/media/movies,/media/tv"),
        STREAM_WIDTH: EnvValue.fromValue("1280"),
        STREAM_HEIGHT: EnvValue.fromValue("720"),
        STREAM_FPS: EnvValue.fromValue("30"),
        STREAM_BITRATE_KBPS: EnvValue.fromValue("2000"),
        STREAM_HARDWARE_ACCELERATION: EnvValue.fromValue("false"),
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
}
