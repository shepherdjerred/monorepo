import { EnvValue, type ISecret } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import {
  EXPERIMENTS_INTERNAL_ENDPOINT,
  GOLINK_ENDPOINT,
  TRACKER_ENDPOINT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import { experimentsHubConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/experiments/index.ts";

/**
 * Environment for the ops-snapshot collector and digest trigger on the infra
 * worker. The URLs are in-cluster bootstrap addresses; the two credentials
 * are required fields of the Temporal worker 1Password item. Prometheus,
 * Bugsink, Woodpecker, GitHub App, and talosconfig access come from the
 * homelab-audit environment the infra worker already carries.
 */
export function opsSnapshotEnv(secret: ISecret): Record<string, EnvValue> {
  return {
    OPS_DASHBOARD_URL: EnvValue.fromValue(
      "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    ),
    ALERTMANAGER_URL: EnvValue.fromValue(
      "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
    ),
    GOLINK_URL: EnvValue.fromValue(GOLINK_ENDPOINT.url),
    LOKI_URL: EnvValue.fromValue("http://loki.loki.svc.cluster.local:3100"),
    TEMPO_URL: EnvValue.fromValue("http://tempo.tempo.svc.cluster.local:3200"),
    OPS_INGEST_TOKEN: EnvValue.fromSecretValue({
      secret,
      key: "OPS_INGEST_TOKEN",
    }),
    TRACKER_URL: EnvValue.fromValue(TRACKER_ENDPOINT.url),
    TRACKER_PUBLIC_URL: EnvValue.fromValue(tailnetService("tracker").origin),
    ...(experimentsHubConfig.active
      ? {
          EXPERIMENTS_INTERNAL_URL: EnvValue.fromValue(
            EXPERIMENTS_INTERNAL_ENDPOINT.url,
          ),
        }
      : {}),
    POSTHOG_PERSONAL_API_KEY: EnvValue.fromSecretValue({
      secret,
      key: "POSTHOG_PERSONAL_API_KEY",
    }),
  };
}
