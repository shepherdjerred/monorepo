import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const STREAMBOT_UID = 1000;
const STREAMBOT_GID = 1000;
const SERVER_PORT = 3000;

export function createStreambotDeployment(chart: Chart) {
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

  const videoVolume = new ZfsNvmeVolume(chart, "streambot-videos", {
    storage: Size.gibibytes(128),
  });
  const cacheVolume = new ZfsNvmeVolume(chart, "streambot-cache", {
    storage: Size.gibibytes(16),
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
          "StreamBot writes yt-dlp state, uploaded videos, and preview cache at runtime.",
      },
    },
  });

  deployment.addContainer(
    withCommonProps({
      name: "streambot",
      image: `quay.io/ydrag0n/streambot:${versions["ydrag0n/streambot"]}`,
      portNumber: SERVER_PORT,
      envVariables: {
        TOKEN: EnvValue.fromSecretValue({ secret, key: "TOKEN" }),
        PREFIX: EnvValue.fromValue("$"),
        GUILD_ID: EnvValue.fromSecretValue({ secret, key: "GUILD_ID" }),
        COMMAND_CHANNEL_ID: EnvValue.fromSecretValue({
          secret,
          key: "COMMAND_CHANNEL_ID",
        }),
        VIDEO_CHANNEL_ID: EnvValue.fromSecretValue({
          secret,
          key: "VIDEO_CHANNEL_ID",
        }),
        ADMIN_IDS: EnvValue.fromSecretValue({ secret, key: "ADMIN_IDS" }),
        VIDEOS_DIR: EnvValue.fromValue("/home/bots/StreamBot/videos"),
        PREVIEW_CACHE_DIR: EnvValue.fromValue(
          "/home/bots/StreamBot/tmp/preview-cache",
        ),
        STREAM_RESPECT_VIDEO_PARAMS: EnvValue.fromValue("false"),
        STREAM_BITRATE_OVERRIDE: EnvValue.fromValue("false"),
        STREAM_WIDTH: EnvValue.fromValue("1280"),
        STREAM_HEIGHT: EnvValue.fromValue("720"),
        STREAM_MAX_WIDTH: EnvValue.fromValue("0"),
        STREAM_MAX_HEIGHT: EnvValue.fromValue("0"),
        STREAM_FPS: EnvValue.fromValue("30"),
        STREAM_BITRATE_KBPS: EnvValue.fromValue("2000"),
        STREAM_MAX_BITRATE_KBPS: EnvValue.fromValue("2500"),
        STREAM_HARDWARE_ACCELERATION: EnvValue.fromValue("false"),
        STREAM_VIDEO_CODEC: EnvValue.fromValue("H264"),
        STREAM_H26X_PRESET: EnvValue.fromValue("ultrafast"),
        SERVER_ENABLED: EnvValue.fromValue("true"),
        SERVER_USERNAME: EnvValue.fromSecretValue({
          secret,
          key: "SERVER_USERNAME",
        }),
        SERVER_PASSWORD: EnvValue.fromSecretValue({
          secret,
          key: "SERVER_PASSWORD",
        }),
        SERVER_PORT: EnvValue.fromValue(String(SERVER_PORT)),
      },
      securityContext: {
        user: STREAMBOT_UID,
        group: STREAMBOT_GID,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
      },
      volumeMounts: [
        {
          path: "/home/bots/StreamBot/videos",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "streambot-videos-volume",
            videoVolume.claim,
          ),
        },
        {
          path: "/home/bots/StreamBot/tmp",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "streambot-cache-volume",
            cacheVolume.claim,
          ),
        },
        {
          // StreamBot downloads (and self-updates) the yt-dlp binary into
          // `${cwd}/scripts` at runtime. The image's WORKDIR is root-owned, but we
          // run as UID 1000, so without a writable mount here the `mkdir`/download
          // fails (EACCES) and every YouTube/URL play breaks with `yt-dlp ENOENT`.
          // An emptyDir is correct: the binary is ephemeral, re-fetched on start.
          path: "/home/bots/StreamBot/scripts",
          volume: Volume.fromEmptyDir(
            chart,
            "streambot-scripts-volume",
            "streambot-scripts",
          ),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "streambot-service", {
    selector: deployment,
    ports: [{ port: SERVER_PORT }],
  });

  new TailscaleIngress(chart, "streambot-tailscale-ingress", {
    service,
    host: "streambot",
  });
}
