import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  EnvValue,
  EnvFieldPaths,
  type ISecret,
  type PersistentVolumeClaim,
  Volume,
} from "cdk8s-plus-31";
import { createTemporalDomainWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/domain-worker.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { createLegacyObserverAccount } from "./legacy-observer.ts";
import {
  MEDIA_APPLICATION_LABEL,
  MEDIA_PUBLIC_ORIGIN,
  mediaDatabaseEnvironment,
  mediaFeatureFlagEnvironment,
} from "./environment.ts";

export type MediaApplicationClaims = {
  movies: PersistentVolumeClaim;
  tv: PersistentVolumeClaim;
  downloads: PersistentVolumeClaim;
};

export function createMediaActivityWorkers(
  chart: Chart,
  props: {
    database: ISecret;
    bootstrap: ISecret;
    postal: ISecret;
    plex: { serviceName: string; tokenSecret: ISecret };
    qbittorrent: ISecret;
    claims: MediaApplicationClaims;
  },
) {
  const shared = {
    ...mediaDatabaseEnvironment(props.database),
    ...mediaFeatureFlagEnvironment(),
    TEMPORAL_ADDRESS: EnvValue.fromValue(
      "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    ),
    TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
    TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
    ENVIRONMENT: EnvValue.fromValue("production"),
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
  };
  const network = createTemporalDomainWorker(chart, {
    name: "media-network",
    serviceAccount: createLegacyObserverAccount(chart),
    automountServiceAccountToken: true,
    component: "media-network",
    featureFlagsEnabled: false,
    podLabels: { [MEDIA_APPLICATION_LABEL]: "true" },
    cpuRequest: Cpu.millis(100),
    cpuLimit: Cpu.millis(1000),
    memoryRequest: Size.mebibytes(256),
    memoryLimit: Size.gibibytes(1),
    envVariables: {
      ...shared,
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("media-network"),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("media-network"),
      MEDIA_CREDENTIAL_KEY: EnvValue.fromSecretValue({
        secret: props.bootstrap,
        key: "MEDIA_CREDENTIAL_KEY",
      }),
      TMDB_API_KEY: EnvValue.fromSecretValue({
        secret: props.bootstrap,
        key: "TMDB_API_KEY",
      }),
      POSTAL_API_KEY: EnvValue.fromSecretValue({
        secret: props.postal,
        key: "POSTAL_API_KEY",
      }),
      POSTAL_HOST: EnvValue.fromValue(
        "http://postal-postal-web-service.postal.svc.cluster.local:5000",
      ),
      POSTAL_HOST_HEADER: EnvValue.fromValue("postal.tailnet-1a49.ts.net"),
      PLEX_SERVER_URL: EnvValue.fromValue(
        `http://${props.plex.serviceName}.media.svc.cluster.local:32400`,
      ),
      PLEX_SERVER_TOKEN: EnvValue.fromSecretValue({
        secret: props.plex.tokenSecret,
        key: "password",
      }),
      PLEX_SERVER_MACHINE_ID: EnvValue.fromSecretValue({
        secret: props.bootstrap,
        key: "PLEX_SERVER_MACHINE_ID",
      }),
      QBITTORRENT_URL: EnvValue.fromValue(
        "http://media-qbittorrent-service.media.svc.cluster.local:8080",
      ),
      QBITTORRENT_USERNAME: EnvValue.fromValue("jerred"),
      QBITTORRENT_PASSWORD: EnvValue.fromSecretValue({
        secret: props.qbittorrent,
        key: "password",
      }),
      PUBLIC_ORIGIN: EnvValue.fromValue(MEDIA_PUBLIC_ORIGIN),
      QBITTORRENT_DOWNLOAD_ROOT: EnvValue.fromValue("/downloads"),
    },
  });
  const files = createTemporalDomainWorker(chart, {
    name: "media-files",
    component: "media-files",
    featureFlagsEnabled: false,
    podLabels: { [MEDIA_APPLICATION_LABEL]: "true" },
    cpuRequest: Cpu.millis(250),
    cpuLimit: Cpu.millis(2000),
    memoryRequest: Size.mebibytes(512),
    memoryLimit: Size.gibibytes(2),
    envVariables: {
      ...shared,
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("media-files"),
      PLEX_SERVER_MACHINE_ID: EnvValue.fromSecretValue({
        secret: props.bootstrap,
        key: "PLEX_SERVER_MACHINE_ID",
      }),
      MEDIA_FILE_WORKER_POD_UID: EnvValue.fromFieldRef(EnvFieldPaths.POD_UID),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("media-files"),
      MEDIA_MOVIES_DOWNLOAD_ROOT: EnvValue.fromValue("/downloads"),
      MEDIA_TV_DOWNLOAD_ROOT: EnvValue.fromValue("/downloads"),
      MEDIA_MOVIES_LIBRARY_ROOT: EnvValue.fromValue("/data/movies"),
      MEDIA_TV_LIBRARY_ROOT: EnvValue.fromValue("/data/tv"),
      MEDIA_MOVIES_CONTROL_ROOT: EnvValue.fromValue(
        "/data/movies/.media-control",
      ),
      MEDIA_TV_CONTROL_ROOT: EnvValue.fromValue("/data/tv/.media-control"),
    },
    volumeMounts: [
      {
        path: "/downloads",
        volume: Volume.fromPersistentVolumeClaim(
          chart,
          "media-files-downloads",
          props.claims.downloads,
        ),
        readOnly: true,
      },
      {
        path: "/data/movies",
        volume: Volume.fromPersistentVolumeClaim(
          chart,
          "media-files-movies",
          props.claims.movies,
        ),
      },
      {
        path: "/data/tv",
        volume: Volume.fromPersistentVolumeClaim(
          chart,
          "media-files-tv",
          props.claims.tv,
        ),
      },
    ],
  });
  return { network, files };
}
