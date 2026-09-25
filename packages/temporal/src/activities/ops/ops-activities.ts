import { AlertmanagerClient } from "@shepherdjerred/ops-clients/alertmanager.ts";
import { BugsinkClient } from "@shepherdjerred/ops-clients/bugsink.ts";
import { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import { GitHubClient } from "@shepherdjerred/ops-clients/github.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { KubernetesClient } from "@shepherdjerred/ops-clients/kubernetes.ts";
import { LinearClient } from "@shepherdjerred/ops-clients/linear.ts";
import { LokiClient } from "@shepherdjerred/ops-clients/loki.ts";
import { PostHogClient } from "@shepherdjerred/ops-clients/posthog.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { SourceId } from "@shepherdjerred/ops-model/snapshot.ts";
import { captureCommand } from "#activities/command-runner.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  buildOpsIngest,
  postJson,
  publishOpsIngest,
  recordSourceSuccesses,
  triggerDigest,
  type OpsCollectorOutcome,
  type OpsDigestKind,
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
  collectLinear,
  collectLogs,
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

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required for the ops snapshot`);
  }
  return value.trim();
}

/** Woodpecker's numeric repository id, from the same item as its token. */
function requiredRepoId(): number {
  const repoId = Number(requiredEnvironment("WOODPECKER_REPO_ID"));
  if (!Number.isInteger(repoId) || repoId <= 0) {
    throw new Error("WOODPECKER_REPO_ID must be a positive integer");
  }
  return repoId;
}

/** Credentials whose values must never appear in a stored failure reason. */
const SECRET_ENVIRONMENT = [
  "OPS_INGEST_TOKEN",
  "LINEAR_API_KEY",
  "POSTHOG_PERSONAL_API_KEY",
  "BUGSINK_TOKEN",
  "WOODPECKER_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
] as const;

const SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

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

function inClusterKubernetes(): KubernetesClient {
  const host = requiredEnvironment("KUBERNETES_SERVICE_HOST");
  const port = requiredEnvironment("KUBERNETES_SERVICE_PORT");
  return new KubernetesClient({
    baseUrl: `https://${host}:${port}`,
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

function monorepo(): GitHubClient {
  return new GitHubClient({
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
    return await timed("renovate", () => collectRenovate(monorepo()));
  },
  async collectOpsLinear(): Promise<OpsSourceResult> {
    return await timed("linear", () =>
      collectLinear(
        new LinearClient({ apiKey: requiredEnvironment("LINEAR_API_KEY") }),
      ),
    );
  },
  async collectOpsBugsink(): Promise<OpsSourceResult> {
    return await timed("bugsink", (context) =>
      collectBugsink(
        new BugsinkClient({
          baseUrl: requiredEnvironment("BUGSINK_URL"),
          token: requiredEnvironment("BUGSINK_TOKEN"),
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
  async collectOpsMaintenance(): Promise<OpsSourceResult> {
    return await timed("maintenance", () => collectMaintenance(prometheus()));
  },
  async collectOpsAi(): Promise<OpsSourceResult> {
    return await timed("ai", (context) => collectAi(prometheus(), context));
  },

  async assembleAndPublishOpsSnapshot(input: {
    outcomes: OpsCollectorOutcome[];
  }): Promise<OpsPublishSummary> {
    const secrets = SECRET_ENVIRONMENT.map((name) => Bun.env[name]);
    const ingest = buildOpsIngest({
      outcomes: input.outcomes,
      now: new Date(),
      lastSuccess: lastSourceSuccess,
      secrets,
    });
    recordSourceSuccesses(input.outcomes, lastSourceSuccess);
    return await publishOpsIngest({
      ingest,
      dashboardUrl: requiredEnvironment("OPS_DASHBOARD_URL"),
      token: requiredEnvironment("OPS_INGEST_TOKEN"),
      post: postJson,
    });
  },

  async triggerOpsDigest(
    kind: OpsDigestKind,
  ): Promise<{ kind: OpsDigestKind }> {
    return await triggerDigest({
      kind,
      dashboardUrl: requiredEnvironment("OPS_DASHBOARD_URL"),
      token: requiredEnvironment("OPS_INGEST_TOKEN"),
      post: postJson,
    });
  },
};
