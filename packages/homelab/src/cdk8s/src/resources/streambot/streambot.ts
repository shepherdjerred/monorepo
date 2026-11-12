import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createStreambotScheduling } from "./scheduling.ts";
import type { Chart } from "cdk8s";
import { ApiObject, JsonPatch, Size } from "cdk8s";
import {
  Cpu,
  EnvValue,
  type ISecret,
  type PersistentVolumeClaim,
  Secret,
  type Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { FirstPartyWorker } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/worker.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { peerUserbotIds } from "@shepherdjerred/homelab/cdk8s/src/resources/userbot-ids.ts";
import {
  createStreambotWeb,
  streambotWebProbes,
} from "@shepherdjerred/homelab/cdk8s/src/resources/streambot/web.ts";
import {
  fliptEnv,
  telemetryEnv,
  seaweedfsS3,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

const STREAMBOT_UID = 1000;
const STREAMBOT_GID = 1000;

/**
 * First-party streambot with optional authenticated web bootstrap. Media stays in Discord.
 *
 * Runs in the `media` namespace so it can read-only mount the existing movies/tv libraries
 * (RWO PVCs, same single node as Plex). yt-dlp + ffmpeg are baked into the image.
 */
export function createStreambotDeployment(
  chart: Chart,
  claims: { movies: PersistentVolumeClaim; tv: PersistentVolumeClaim },
  web?: {
    publicOrigin: string;
    plex?: { service: Service; tokenSecret: ISecret };
  },
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

  // Dedicated item for the voice assistant's OpenAI project key, separate from streambot-config
  // so it can rotate and carry its own spend ceiling independently. Its single `OPENAI_API_KEY`
  // field syncs to a secret key of the same name.
  const openAiItem = new OnePasswordItem(chart, "streambot-openai", {
    spec: {
      itemPath: vaultItemPath("streambot-openai"),
    },
  });
  const openAiSecret = Secret.fromSecretName(
    chart,
    "streambot-openai-secret",
    openAiItem.name,
  );

  // Streambot uses the same PinchTab bearer token as the browser service, but its own
  // profile. The token is synced into the media namespace through this declared 1Password item.
  const pinchtabItem = new OnePasswordItem(chart, "streambot-pinchtab-1p", {
    spec: {
      itemPath: vaultItemPath("t2dgtdx47yd2gegad6zeelzylu"),
    },
    metadata: {
      name: "streambot-pinchtab-token",
    },
  });
  const pinchtabSecret = Secret.fromSecretName(
    chart,
    "streambot-pinchtab-token-secret",
    pinchtabItem.name,
  );

  // Mirror the shared SeaweedFS credentials into the media namespace. Voice
  // diagnostics use a private, lifecycle-managed bucket and never make the
  // audio part of logs or telemetry.
  const seaweedfsItem = seaweedfsS3.item(
    chart,
    "streambot-seaweedfs-1p",
    "streambot-seaweedfs-s3-credentials",
  );
  const seaweedfsSecret = Secret.fromSecretName(
    chart,
    "streambot-seaweedfs-secret",
    seaweedfsItem.name,
  );

  // Small persistent volume for resume state and the media-history SQLite database. Survives
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

  // The items and claims above predate the Deployment in the rendered chart,
  // so they stay outside the worker; the web and scheduler Services render
  // between the Deployment and the metrics Service, so they are created while
  // the containers are built.
  const worker = new FirstPartyWorker(chart, "streambot-worker", {
    name: "streambot",
    deployment: {
      podMetadata: { labels: { app: "streambot" } },
      securityContext: {
        fsGroup: STREAMBOT_GID,
      },
      metadata: {
        annotations: {
          "ignore-check.kube-linter.io/no-read-only-root-fs":
            "Bun writes its install cache and ffmpeg writes temp files at runtime.",
        },
      },
    },
    containers: (deployment) => {
      // Enable in the owning media chart only after the OAuth secret and redirect are provisioned.
      // A required secretKeyRef is used when enabled; an incomplete bootstrap must fail startup.
      const webServer =
        web === undefined
          ? undefined
          : createStreambotWeb(chart, deployment, {
              secret,
              publicOrigin: web.publicOrigin,
            });
      const scheduling = createStreambotScheduling(chart, deployment);
      return {
        main: {
          name: "streambot",
          image: firstPartyImageRecipe("streambot"),
          envVariables: {
            ...(web?.plex === undefined
              ? {}
              : {
                  PLEX_BASE_URL: EnvValue.fromValue(
                    `http://${web.plex.service.name}.media.svc.cluster.local:32400`,
                  ),
                  PLEX_TOKEN: EnvValue.fromSecretValue({
                    secret: web.plex.tokenSecret,
                    key: "password",
                  }),
                }),
            BOT_TOKEN: fromSecret("BOT_TOKEN"),
            // Pool of userbot tokens (comma-separated, one per Discord account). The bot acquires a free
            // member-userbot per (guild, voice channel); guild/channel are now dynamic (the issuer's VC),
            // so GUILD_ID/VIDEO_CHANNEL_ID/COMMAND_CHANNEL_ID are no longer needed.
            USER_TOKENS: fromSecret("USER_TOKENS"),
            // This grants bot administration and stays under Git review.
            ADMIN_IDS: EnvValue.fromValue("160509172704739328"),
            // Peer userbot Discord user IDs (Pokébot + Glitter Kart) so the alone-channel
            // detector excludes them from the "real viewers" count and leaves once the
            // last human exits. Sourced from the canonical map in resources/userbot-ids.ts.
            // Bootstrap for the flag client — cannot come from a flag.
            ...fliptEnv({
              namespace: "streambot",
              environment: "prod",
              order: ["FLIPT_ENVIRONMENT", "FLIPT_NAMESPACE", "FLIPT_URL"],
            }),
            PINCHTAB_BASE_URL: EnvValue.fromValue(
              "http://pinchtab.pinchtab.svc.cluster.local:9867",
            ),
            PINCHTAB_TOKEN: EnvValue.fromSecretValue({
              secret: pinchtabSecret,
              key: "PINCHTAB_TOKEN",
            }),
            PEER_USERBOT_IDS: EnvValue.fromValue(peerUserbotIds("streambot")),
            // Enables movie/TV poster art on the now-playing embed for local files. Sourced from the
            // dedicated streambot-tmdb item. Required — the item must carry TMDB_API_KEY or the pod
            // fails to start (fail-fast; no silently-missing secrets).
            TMDB_API_KEY: EnvValue.fromSecretValue({
              secret: tmdbSecret,
              key: "TMDB_API_KEY",
            }),
            // Global kill switch and the only rollback control: flip to "false" via GitOps to turn
            // voice off. Cloud exposure is bounded by the per-session rate limiter and the spend
            // ceiling on the OpenAI project key.
            VOICE_ASSISTANT_ENABLED: EnvValue.fromValue("true"),
            OPENAI_API_KEY: EnvValue.fromSecretValue({
              secret: openAiSecret,
              key: "OPENAI_API_KEY",
            }),
            VOICE_ASSETS_DIR: EnvValue.fromValue("/opt/streambot/voice"),
            VOICE_KWS_RUNTIME: EnvValue.fromValue("auto"),
            VOICE_CAPTURE_ENABLED: EnvValue.fromValue("true"),
            VOICE_CAPTURE_BUCKET: EnvValue.fromValue(
              "streambot-voice-captures",
            ),
            S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
            S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
            AWS_REGION: EnvValue.fromValue("us-east-1"),
            ...seaweedfsS3.credentialsEnv(seaweedfsSecret),
            ...telemetryEnv({
              serviceName: "streambot",
              serviceNameFirst: true,
            }),
            LOKI_OTLP_ENDPOINT: EnvValue.fromValue(
              "http://loki-gateway.loki/otlp/v1/logs",
            ),
            VIDEOS_DIR: EnvValue.fromValue("/data/videos"),
            MEDIA_DIRS: EnvValue.fromValue("/media/movies,/media/tv"),
            // Resume state and durable media history live on the persistent volume mounted at /state.
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
            // Bugsink error reporting → project 14 (Streambot). Required
            // (fail-fast): the streambot-config item must carry BUGSINK_DSN. VERSION
            // is baked into the image; it and ENVIRONMENT become the Bugsink release
            // and environment.
            BUGSINK_DSN: fromSecret("BUGSINK_DSN"),
            ENVIRONMENT: EnvValue.fromValue("production"),
            ...webServer?.envVariables,
            ...scheduling.envVariables,
          },
          ports: [
            { number: 9466, name: "metrics" },
            ...(webServer?.ports ?? []),
            ...scheduling.ports,
          ],
          ...(web === undefined ? {} : streambotWebProbes()),
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
            // Request the measured p95 working set (454Mi over 7d, 2026-10-31);
            // 4K remux bursts (1.8Gi in that window) use the limit.
            memory: {
              request: Size.mebibytes(512),
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
        },
      };
    },
    // Internal-only metrics Service + ServiceMonitor so Prometheus scrapes the streambot `/metrics`
    // endpoint on :9466. The separate web Service never exposes this port.
    metrics: {
      serviceId: "streambot-metrics-service",
      serviceName: "streambot-metrics",
      app: "streambot-metrics",
      port: 9466,
      targetPort: 9466,
      monitorName: "streambot-metrics",
    },
    // The media chart owns the namespace's policies; the scheduler's ingress
    // policy renders with its Service.
    policies: [],
  });

  // Request the Intel iGPU so ffmpeg can VAAPI hardware-encode. The intel-device-plugin mounts
  // /dev/dri into the pod; non-root UID 1000 works. The GPU resource patch
  // (scripts/patch.ts) leaves an explicit `1` untouched.
  ApiObject.of(worker.deployment).addJsonPatch(
    JsonPatch.add(
      "/spec/template/spec/containers/0/resources/limits/gpu.intel.com~1i915",
      1,
    ),
  );
}
