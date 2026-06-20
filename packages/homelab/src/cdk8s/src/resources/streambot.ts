import type { Chart } from "cdk8s";
import { ApiObject, JsonPatch, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type PersistentVolumeClaim,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { peerUserbotIds } from "@shepherdjerred/homelab/cdk8s/src/resources/userbot-ids.ts";
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

  // Dedicated item for the optional TMDB poster API key (kept out of the shared streambot-config
  // item). Its single `TMDB_API_KEY` field syncs to a secret key of the same name.
  const tmdbItem = new OnePasswordItem(chart, "streambot-tmdb", {
    spec: {
      itemPath: vaultItemPath("streambot-tmdb"),
    },
  });
  const tmdbSecret = Secret.fromSecretName(
    chart,
    "streambot-tmdb-secret",
    tmdbItem.name,
  );

  // Small persistent volume for resume state (current item + playback position + queue). Survives
  // pod restarts so a deploy/crash mid-movie picks up where it left off. RWO + the Recreate strategy
  // below guarantees the old pod detaches before the new one attaches (a rolling update would
  // multi-attach-conflict).
  const stateVolume = new ZfsNvmeVolume(chart, "streambot-state-pvc", {
    storage: Size.gibibytes(1),
  });

  // Small persistent cache of extracted embedded subtitle tracks (a few MB of .srt per title).
  // Extracting an embedded sub from a large remux needs a full demux pass (tens of seconds for a 4K
  // Blu-ray); caching the result makes every repeat play start instantly. Kept separate from /state
  // so resume state and the subtitle cache can be sized and cleared independently. RWO is safe here
  // for the same reason as /state: the Recreate strategy detaches the old pod before the new attaches.
  const subsCacheVolume = new ZfsNvmeVolume(chart, "streambot-subs-cache-pvc", {
    storage: Size.gibibytes(2),
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
        // Pool of userbot tokens (comma-separated, one per Discord account). The bot acquires a free
        // member-userbot per (guild, voice channel); guild/channel are now dynamic (the issuer's VC),
        // so GUILD_ID/VIDEO_CHANNEL_ID/COMMAND_CHANNEL_ID are no longer needed.
        USER_TOKENS: fromSecret("USER_TOKENS"),
        ADMIN_IDS: fromSecret("ADMIN_IDS"),
        // Peer userbot Discord user IDs (Pokébot + Glitter Kart) so the alone-channel
        // detector excludes them from the "real viewers" count and leaves once the
        // last human exits. Sourced from the canonical map in resources/userbot-ids.ts.
        PEER_USERBOT_IDS: EnvValue.fromValue(peerUserbotIds("streambot")),
        // Enables movie/TV poster art on the now-playing embed for local files. Sourced from the
        // dedicated streambot-tmdb item. Required — the item must carry TMDB_API_KEY or the pod
        // fails to start (fail-fast; no silently-missing secrets).
        TMDB_API_KEY: EnvValue.fromSecretValue({
          secret: tmdbSecret,
          key: "TMDB_API_KEY",
        }),
        VIDEOS_DIR: EnvValue.fromValue("/data/videos"),
        MEDIA_DIRS: EnvValue.fromValue("/media/movies,/media/tv"),
        // Resume state lives on the persistent volume mounted at /state.
        STATE_DIR: EnvValue.fromValue("/state"),
        // Extracted embedded subtitles are cached on the persistent volume mounted at /subs-cache.
        SUBS_CACHE_DIR: EnvValue.fromValue("/subs-cache"),
        STREAM_WIDTH: EnvValue.fromValue("1920"),
        STREAM_HEIGHT: EnvValue.fromValue("1080"),
        STREAM_FPS: EnvValue.fromValue("30"),
        STREAM_BITRATE_KBPS: EnvValue.fromValue("4000"),
        STREAM_HARDWARE_ACCELERATION: EnvValue.fromValue("true"),
        VAAPI_DEVICE: EnvValue.fromValue("/dev/dri/renderD128"),
        // Intel iHD VAAPI driver for QuickSync hardware encoding.
        LIBVA_DRIVER_NAME: EnvValue.fromValue("iHD"),
        // Prometheus /metrics endpoint (scraped by the ServiceMonitor below).
        METRICS_PORT: EnvValue.fromValue("9466"),
        // Sentry error reporting → Bugsink project 14 (Streambot). Required
        // (fail-fast): the streambot-config item must carry SENTRY_DSN. VERSION
        // is baked into the image; both surface as the Sentry release/environment.
        SENTRY_DSN: fromSecret("SENTRY_DSN"),
        ENVIRONMENT: EnvValue.fromValue("production"),
      },
      ports: [{ number: 9466, name: "metrics" }],
      securityContext: {
        user: STREAMBOT_UID,
        group: STREAMBOT_GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
      },
      resources: {
        // 4K remuxes (e.g. 2160p Blu-ray) are demanding even with VAAPI: bursty CPU for demux +
        // decode orchestration + Opus/voice work would peg the old 2-core limit, and CFS throttling
        // stalled the event loop → late frames → stream stutter. Memory likewise blew past 2Gi and
        // OOMKilled the pod into a crash loop. Limits raised with generous headroom; the node
        // (torvalds) has 32 cores / 128Gi, so this is comfortably within capacity.
        cpu: {
          request: Cpu.millis(2000),
          limit: Cpu.millis(12_000),
        },
        memory: {
          request: Size.gibibytes(2),
          limit: Size.gibibytes(12),
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
          // Persistent cache of extracted embedded subtitle .srt files, reused across plays/restarts.
          path: "/subs-cache",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "streambot-subs-cache-volume",
            subsCacheVolume.claim,
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

  // Internal-only metrics Service + ServiceMonitor so Prometheus scrapes the streambot `/metrics`
  // endpoint on :9466. Not Ingress-exposed — streambot is otherwise Discord-only outbound.
  new Service(chart, "streambot-metrics-service", {
    selector: deployment,
    metadata: {
      name: "streambot-metrics",
      labels: { app: "streambot-metrics" },
    },
    ports: [{ name: "metrics", port: 9466, targetPort: 9466 }],
  });

  createServiceMonitor(chart, {
    name: "streambot-metrics",
    matchLabels: { app: "streambot-metrics" },
  });
}
