import { AlertmanagerClient } from "@shepherdjerred/ops-clients/alertmanager.ts";
import { BugsinkClient } from "@shepherdjerred/ops-clients/bugsink.ts";
import { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import {
  GitHubClient,
  type MergedPullRequest,
  type OpenPullRequest,
} from "@shepherdjerred/ops-clients/github.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { KubernetesClient } from "@shepherdjerred/ops-clients/kubernetes.ts";
import { TrackerClient } from "@shepherdjerred/ops-clients/tracker.ts";
import { LokiClient } from "@shepherdjerred/ops-clients/loki.ts";
import { TempoClient } from "@shepherdjerred/ops-clients/tempo.ts";
import { PostHogClient } from "@shepherdjerred/ops-clients/posthog.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { SourceId } from "@shepherdjerred/ops-model/snapshot.ts";
import type { DigestKind as OpsDigestKind } from "@shepherdjerred/ops-model/digest.ts";
import {
  parseTemporalNamespace,
  temporalNamespacesForMonitoring,
} from "#shared/infra/temporal-namespace.ts";
import { captureCommand } from "#activities/command-runner.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { collectAuxiliaryFacets } from "./facets/auxiliary-facets.ts";
import {
  buildTemporalFacet,
  fetchTemporalWorkerDeployments,
} from "./facets/temporal-facet.ts";
import {
  buildOpsIngest,
  postJson,
  publishOpsIngest,
  recordSourceSuccesses,
  triggerDigest,
  type OpsCollectorOutcome,
  type OpsPublishSummary,
} from "./ops-publish.ts";
import {
  collectAi,
  collectAlerts,
  collectArgo,
  collectBugsink,
  collectCi,
  collectGitHub,
  collectKubernetes,
  collectTracker,
  collectLogs,
  collectTraces,
  collectMaintenance,
  collectPostHog,
  collectProbes,
  collectRenovate,
  collectTalos,
  type Talosctl,
} from "./ops-sources.ts";
import type {
  OpsCollection,
  OpsContext,
  OpsSourceResult,
} from "./ops-types.ts";
import { readTemporalScheduleHealth } from "./temporal-schedules-client.ts";
import { collectTemporalSchedules } from "./temporal-schedules-collector.ts";
import { collectCiMaintenanceBlockedSignals } from "./ci-maintenance/ci-maintenance-ops.ts";

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required for the ops snapshot`);
  }
  return value.trim();
}

function optionalEnvironment(name: string): string | undefined {
  const value = Bun.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** Woodpecker's numeric repository id, from the same item as its token. */
function requiredRepoId(): number {
  const repoId = Number(requiredEnvironment("WOODPECKER_REPO_ID"));
  if (!Number.isInteger(repoId) || repoId <= 0) {
    throw new Error("WOODPECKER_REPO_ID must be a positive integer");
  }
  return repoId;
}

function optionalWoodpeckerLinkConfig(): {
  woodpeckerBaseUrl?: string;
  woodpeckerRepoId?: number;
} {
  const baseUrl = optionalEnvironment("WOODPECKER_URL");
  const rawRepoId = optionalEnvironment("WOODPECKER_REPO_ID");
  if (rawRepoId === undefined) {
    return baseUrl === undefined ? {} : { woodpeckerBaseUrl: baseUrl };
  }
  const repoId = Number(rawRepoId);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    throw new Error("WOODPECKER_REPO_ID must be a positive integer");
  }
  return {
    ...(baseUrl === undefined ? {} : { woodpeckerBaseUrl: baseUrl }),
    woodpeckerRepoId: repoId,
  };
}

/** Credentials whose values must never appear in a stored failure reason. */
export const SECRET_ENVIRONMENT = [
  "OPS_INGEST_TOKEN",
  "POSTHOG_PERSONAL_API_KEY",
  "WOODPECKER_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "CLOUDFLARE_API_TOKEN",
  "GRAFANA_API_KEY",
  "TAILSCALE_API_KEY",
  "TAILSCALE_OAUTH_CLIENT_SECRET",
] as const;

const SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const GITHUB_PR_CACHE_TTL_MS = 30_000;

/** Trusts the cluster CA the pod's service account projects. */
const clusterFetch: Fetch = async (input, init) => {
  const ca = await Bun.file(`${SERVICE_ACCOUNT_DIR}/ca.crt`).text();
  return await fetch(input, { ...init, tls: { ca } });
};

/** Re-read per request so a rotated projected token is picked up. */
async function serviceAccountToken(): Promise<string> {
  const token = await Bun.file(`${SERVICE_ACCOUNT_DIR}/token`).text();
  return token.trim();
}

function kubernetesBaseUrl(): string | undefined {
  const host = optionalEnvironment("KUBERNETES_SERVICE_HOST");
  const port = optionalEnvironment("KUBERNETES_SERVICE_PORT");
  return host === undefined || port === undefined
    ? undefined
    : `https://${host}:${port}`;
}

function inClusterKubernetes(): KubernetesClient {
  const host = requiredEnvironment("KUBERNETES_SERVICE_HOST");
  const port = requiredEnvironment("KUBERNETES_SERVICE_PORT");
  return new KubernetesClient({
    baseUrl: `https://${host}:${port}`,
    token: serviceAccountToken,
    fetch: clusterFetch,
  });
}

function optionalKubernetes(): KubernetesClient | undefined {
  const baseUrl = kubernetesBaseUrl();
  return baseUrl === undefined
    ? undefined
    : new KubernetesClient({
        baseUrl,
        token: serviceAccountToken,
        fetch: clusterFetch,
      });
}

async function githubAppToken(): Promise<string> {
  const installation = await createGitHubAppInstallationToken();
  return installation.token;
}

function prometheus(): PrometheusClient {
  return new PrometheusClient({
    baseUrl: requiredEnvironment("PROMETHEUS_URL"),
  });
}

function optionalPrometheus(): PrometheusClient | undefined {
  const baseUrl = optionalEnvironment("PROMETHEUS_URL");
  return baseUrl === undefined ? undefined : new PrometheusClient({ baseUrl });
}

function optionalLoki(): LokiClient | undefined {
  const baseUrl = optionalEnvironment("LOKI_URL");
  return baseUrl === undefined ? undefined : new LokiClient({ baseUrl });
}

let cachedOpenPrs:
  { expiresAtMs: number; promise: Promise<OpenPullRequest[]> } | undefined;
let cachedMergedPrs30d:
  | {
      bucketKey: number;
      expiresAtMs: number;
      promise: Promise<MergedPullRequest[]>;
    }
  | undefined;

/**
 * GitHubClient wrapper sharing `openPullRequests()` and 30d `mergedPullRequests()`
 * over a 30s TTL so `collectOpsGithub` and `collectOpsRenovate` in the same tick
 * share one GraphQL pagination pass.
 */
class SharedTickGitHubClient extends GitHubClient {
  override async openPullRequests(): Promise<OpenPullRequest[]> {
    const nowMs = Date.now();
    if (cachedOpenPrs !== undefined && nowMs < cachedOpenPrs.expiresAtMs) {
      return await cachedOpenPrs.promise;
    }
    const promise = super.openPullRequests();
    cachedOpenPrs = { expiresAtMs: nowMs + GITHUB_PR_CACHE_TTL_MS, promise };
    try {
      return await promise;
    } catch (error: unknown) {
      cachedOpenPrs = undefined;
      throw error;
    }
  }

  override async mergedPullRequests(since: Date): Promise<MergedPullRequest[]> {
    const nowMs = Date.now();
    const bucketKey = Math.floor(since.getTime() / GITHUB_PR_CACHE_TTL_MS);
    if (
      cachedMergedPrs30d?.bucketKey === bucketKey &&
      nowMs < cachedMergedPrs30d.expiresAtMs
    ) {
      return await cachedMergedPrs30d.promise;
    }
    const promise = super.mergedPullRequests(since);
    cachedMergedPrs30d = {
      bucketKey,
      expiresAtMs: nowMs + GITHUB_PR_CACHE_TTL_MS,
      promise,
    };
    try {
      return await promise;
    } catch (error: unknown) {
      cachedMergedPrs30d = undefined;
      throw error;
    }
  }
}

function monorepo(): GitHubClient {
  return new SharedTickGitHubClient({
    owner: "shepherdjerred",
    name: "monorepo",
    token: githubAppToken,
  });
}

const talosctl: Talosctl = async (args) => {
  const result = await captureCommand(["talosctl", ...args], { cwd: "/tmp" });
  if (result.exitCode !== 0) {
    throw new Error(
      `talosctl ${args.slice(0, 2).join(" ")} exited ${String(result.exitCode)}: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  return result.stdout;
};

// Process-local state. Argo does not record when an app went OutOfSync, and a
// failed source reports its last success; both reset on worker restart, which
// only delays a warning or omits `lastSuccessAt` for one failure.
const argoOutOfSyncSince = new Map<string, Date>();
const lastSourceSuccess = new Map<SourceId, string>();
const services = new ServiceIndex();

async function timed(
  source: SourceId,
  collect: (context: OpsContext) => Promise<OpsCollection>,
): Promise<OpsSourceResult> {
  const started = new Date();
  const collection = await collect({ now: started, services });
  const finished = new Date();
  return {
    status: {
      source,
      ok: true,
      observedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
    },
    ...collection,
  };
}

export type OpsActivities = typeof opsActivities;

export const opsActivities = {
  async collectOpsAlerts(): Promise<OpsSourceResult> {
    return await timed("alerts", (context) =>
      collectAlerts(
        new AlertmanagerClient({
          baseUrl: requiredEnvironment("ALERTMANAGER_URL"),
        }),
        context,
      ),
    );
  },
  async collectOpsKubernetes(): Promise<OpsSourceResult> {
    return await timed("kubernetes", (context) =>
      collectKubernetes(inClusterKubernetes(), context),
    );
  },
  async collectOpsArgocd(): Promise<OpsSourceResult> {
    return await timed("argocd", (context) =>
      collectArgo(inClusterKubernetes(), argoOutOfSyncSince, context),
    );
  },
  async collectOpsTalos(): Promise<OpsSourceResult> {
    requiredEnvironment("TALOSCONFIG");
    return await timed("talos", () => collectTalos(talosctl));
  },
  async collectOpsCi(): Promise<OpsSourceResult> {
    return await timed("ci", (context) =>
      collectCi(
        new WoodpeckerClient({
          baseUrl: requiredEnvironment("WOODPECKER_URL"),
          token: requiredEnvironment("WOODPECKER_TOKEN"),
          repoId: requiredRepoId(),
        }),
        context,
      ),
    );
  },
  async collectOpsGithub(): Promise<OpsSourceResult> {
    return await timed("github", (context) =>
      collectGitHub(monorepo(), context),
    );
  },
  async collectOpsRenovate(): Promise<OpsSourceResult> {
    return await timed("renovate", (context) =>
      collectRenovate(monorepo(), { now: context.now }),
    );
  },
  async collectOpsTracker(): Promise<OpsSourceResult> {
    return await timed("tracker", (context) =>
      collectTracker(
        new TrackerClient({
          baseUrl: requiredEnvironment("TRACKER_URL"),
          publicUrl: requiredEnvironment("TRACKER_PUBLIC_URL"),
        }),
        context.now,
      ),
    );
  },
  /** Retained command name for histories recorded before ops-tracker-source. */
  async collectOpsLinear(): Promise<OpsSourceResult> {
    return await opsActivities.collectOpsTracker();
  },
  async collectOpsBugsink(): Promise<OpsSourceResult> {
    return await timed("bugsink", (context) =>
      collectBugsink(
        new BugsinkClient({
          baseUrl: requiredEnvironment("ERRORS_URL"),
        }),
        context,
      ),
    );
  },
  async collectOpsPosthog(): Promise<OpsSourceResult> {
    return await timed("posthog", (context) =>
      collectPostHog(
        new PostHogClient({
          apiKey: requiredEnvironment("POSTHOG_PERSONAL_API_KEY"),
        }),
        context,
      ),
    );
  },
  async collectOpsProbes(): Promise<OpsSourceResult> {
    return await timed("probes", (context) =>
      collectProbes(prometheus(), context),
    );
  },
  async collectOpsLogs(): Promise<OpsSourceResult> {
    return await timed("logs", (context) =>
      collectLogs(
        new LokiClient({ baseUrl: requiredEnvironment("LOKI_URL") }),
        context,
      ),
    );
  },
  async collectOpsTraces(): Promise<OpsSourceResult> {
    return await timed("traces", (context) =>
      collectTraces(
        new TempoClient({ baseUrl: requiredEnvironment("TEMPO_URL") }),
        context,
      ),
    );
  },
  async collectOpsMaintenance(): Promise<OpsSourceResult> {
    return await timed("maintenance", (context) =>
      collectMaintenance(prometheus(), inClusterKubernetes(), context.now),
    );
  },
  async collectOpsTemporal(): Promise<OpsSourceResult> {
    return await timed("temporal", async (context) => {
      const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
      const k8sBase = kubernetesBaseUrl();
      const [observations, workerDeployments, maintenanceSignals] =
        await Promise.all([
          readTemporalScheduleHealth(namespace, context.now),
          k8sBase === undefined
            ? Promise.resolve([])
            : fetchTemporalWorkerDeployments({
                baseUrl: k8sBase,
                token: serviceAccountToken,
                fetchImpl: clusterFetch,
              }),
          temporalNamespacesForMonitoring(namespace).includes("prod")
            ? collectCiMaintenanceBlockedSignals({
                now: context.now,
                ...optionalWoodpeckerLinkConfig(),
              })
            : Promise.resolve([]),
        ]);
      const collection = await collectTemporalSchedules(
        namespace,
        context,
        () => Promise.resolve(observations),
      );
      const prom = optionalPrometheus();
      const temporalFacet = await buildTemporalFacet({
        observations,
        workerDeployments,
        ...(prom === undefined ? {} : { prometheus: prom }),
        now: context.now,
      });
      return {
        ...collection,
        signals: [...collection.signals, ...maintenanceSignals],
        facets: { temporal: temporalFacet },
      };
    });
  },
  async collectOpsAi(): Promise<OpsSourceResult> {
    return await timed("ai", (context) => collectAi(prometheus(), context));
  },

  async assembleAndPublishOpsSnapshot(input: {
    outcomes: OpsCollectorOutcome[];
  }): Promise<OpsPublishSummary> {
    const now = new Date();
    const secrets = SECRET_ENVIRONMENT.map((name) => Bun.env[name]);
    const k8s = optionalKubernetes();
    const prom = optionalPrometheus();
    const loki = optionalLoki();
    const extraFacets = await collectAuxiliaryFacets({
      outcomes: input.outcomes,
      services,
      ...(k8s === undefined ? {} : { kubernetes: k8s }),
      ...(prom === undefined ? {} : { prometheus: prom }),
      ...(loki === undefined ? {} : { loki }),
      now,
    });
    const ingest = buildOpsIngest({
      outcomes: input.outcomes,
      now,
      lastSuccess: lastSourceSuccess,
      secrets,
      extraFacets,
    });
    recordSourceSuccesses(input.outcomes, lastSourceSuccess);
    return await publishOpsIngest({
      ingest,
      dashboardUrl: requiredEnvironment("OPS_DASHBOARD_URL"),
      token: requiredEnvironment("OPS_INGEST_TOKEN"),
      post: postJson,
    });
  },

  async triggerOpsDigest(kind: OpsDigestKind) {
    return await triggerDigest({
      kind,
      dashboardUrl: requiredEnvironment("OPS_DASHBOARD_URL"),
      token: requiredEnvironment("OPS_INGEST_TOKEN"),
      post: postJson,
    });
  },
};
