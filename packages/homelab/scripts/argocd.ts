#!/usr/bin/env bun
/**
 * ArgoCD operations: trigger a sync, wait for app or app-tree health, and wait
 * for a pruned resource (with a finalizer) to fully delete.
 *
 * Ported from the old CI's `argoCdSyncHelper` / `argoCdHealthWaitHelper` /
 * `waitForArgoCdResourceDeletionHelper` (.dagger/src/release.ts). Runs locally
 * as a plain Bun script using fetch instead of curl+jq; the polling logic and
 * timeouts are preserved.
 *
 * Usage:
 *   bun packages/homelab/scripts/argocd.ts sync <app> [--prune] [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts delete-application <app> \
 *       --project <project> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts health-wait <app> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts tree-health-wait <app> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts wait-deletion <app> \
 *       --group <g> --version <v> --kind <k> --namespace <ns> \
 *       [--timeout <s>] [--dry-run]
 *
 * Env:
 *   ARGOCD_TOKEN     — ArgoCD API bearer token (required unless --dry-run)
 *   ARGOCD_SERVER_URL — optional, defaults to https://argocd.sjer.red
 */

import { requireEnv, optionalEnv } from "../../../scripts/lib/run.ts";
import { runMain } from "../../../scripts/lib/transient.ts";
import {
  applicationReadiness,
  releaseTreeReadiness,
  unreadyApplicationSummaries,
} from "../src/cdk8s/src/argocd-application-readiness.ts";
import {
  APPLICATION_LIFECYCLE_ANNOTATION,
  APPLICATION_RESOURCES_FINALIZER,
  REPOSITORY_CHART_URLS,
} from "../src/cdk8s/src/application-release-policy.ts";
import {
  batchManifestOverrides,
  completedOperationIdentity,
  requestedOperationIdentity,
  SYNC_REQUEST_ID_INFO_NAME,
  type SyncOperationResource,
} from "./argocd-manifest-overrides.ts";
import { latestPublishedVersion } from "./helm-release-core.ts";
import { z } from "zod";

const DEFAULT_SERVER_URL = "https://argocd.sjer.red";
const DEFAULT_CHARTMUSEUM_ORIGIN = "https://chartmuseum.sjer.red";
const DEFAULT_HEALTH_TIMEOUT_S = 300;
const DEFAULT_SYNC_TIMEOUT_S = 300;
const DEFAULT_DELETION_TIMEOUT_S = 120;
const POLL_INTERVAL_MS = 10_000;

const ExpectedApplicationsSchema = z.array(
  z.object({
    name: z.string().min(1),
    revision: z.string().regex(/^2\.0\.0-\d+$/),
    prune: z.boolean().default(false),
  }),
);

const ManifestResponseSchema = z.object({
  manifests: z.array(z.string()),
});

const RenderedApplicationSchema = z
  .object({
    apiVersion: z.string(),
    kind: z.literal("Application"),
    metadata: z.object({ name: z.string() }).passthrough(),
    spec: z
      .object({
        source: z.object({
          repoURL: z.string(),
          chart: z.string().optional(),
        }),
        syncPolicy: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const RenderedObjectSchema = z
  .object({
    kind: z.string(),
  })
  .passthrough();

const ReconcileApplicationSchema = z.object({
  status: z
    .object({
      sync: z
        .object({
          status: z.string(),
          revision: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

function serverUrl(): string {
  return optionalEnv("ARGOCD_SERVER_URL") ?? DEFAULT_SERVER_URL;
}

function chartMuseumOrigin(): string {
  return (
    optionalEnv("CHARTMUSEUM_ORIGIN") ?? DEFAULT_CHARTMUSEUM_ORIGIN
  ).replace(/\/$/, "");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * GET an ArgoCD application. Fails fast on any non-200 (auth/ingress errors are
 * not transient; looping wastes time), surfacing the status and a body snippet
 * — matching the old helper's `-sS -L` behavior with a redirect cap.
 */
async function getApplication(
  appName: string,
  token: string,
): Promise<Record<string, unknown>> {
  const url = `${serverUrl()}/api/v1/applications/${appName}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (res.status !== 200) {
    const body = (await res.text()).slice(0, 1024);
    throw new Error(
      `ERROR: ${url} returned HTTP ${res.status.toString()}\n` +
        `Response body (first 1KB): ${body}`,
    );
  }
  const data: unknown = await res.json();
  if (!isRecord(data)) {
    throw new Error(`${url} returned a non-object body`);
  }
  return data;
}

async function getApplications(token: string): Promise<unknown> {
  const url = `${serverUrl()}/api/v1/applications`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1024);
    throw new Error(
      `ERROR: ${url} returned HTTP ${response.status.toString()}\n${body}`,
    );
  }
  return response.json();
}

async function suspendRepositoryAutoSync(
  rootAppName: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  console.log(
    `--- argocd suspend-auto-sync: repository Applications under ${rootAppName}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const manifestsUrl = `${serverUrl()}/api/v1/applications/${encodeURIComponent(rootAppName)}/manifests`;
  const manifestsResponse = await fetch(manifestsUrl, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!manifestsResponse.ok) {
    const body = (await manifestsResponse.text()).slice(0, 1024);
    throw new Error(
      `Could not render ${rootAppName}: HTTP ${manifestsResponse.status.toString()}\n${body}`,
    );
  }
  const rendered = ManifestResponseSchema.parse(await manifestsResponse.json());
  const suspended = rendered.manifests.flatMap((manifestSource) => {
    const parsed = RenderedObjectSchema.parse(JSON.parse(manifestSource));
    if (parsed.kind !== "Application") {
      return [];
    }
    const application = RenderedApplicationSchema.parse(parsed);
    if (
      application.spec.source.chart === undefined ||
      !REPOSITORY_CHART_URLS.has(application.spec.source.repoURL) ||
      application.spec.syncPolicy === undefined ||
      !Object.hasOwn(application.spec.syncPolicy, "automated")
    ) {
      return [];
    }
    const syncPolicy = Object.fromEntries(
      Object.entries(application.spec.syncPolicy).filter(
        ([key]) => key !== "automated",
      ),
    );
    console.log(`suspending auto-sync: ${application.metadata.name}`);
    return [
      {
        manifest: JSON.stringify({
          ...application,
          spec: { ...application.spec, syncPolicy },
        }),
        resource: {
          group: "argoproj.io",
          kind: "Application",
          name: application.metadata.name,
        },
      },
    ];
  });
  const batches = batchManifestOverrides(suspended);
  for (const [index, batch] of batches.entries()) {
    console.log(
      `syncing suspended Application batch ${(index + 1).toString()}/${batches.length.toString()} (${batch.manifests.length.toString()} resources)`,
    );
    await sync(rootAppName, timeoutSeconds, false, {
      prune: false,
      manifests: batch.manifests,
      resources: batch.resources,
    });
  }
}

async function assertExpectedAppsRevisionIsLatest(
  expectedRevision: string,
): Promise<void> {
  const url = `${chartMuseumOrigin()}/api/charts/apps`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1024);
    throw new Error(
      `ChartMuseum inventory failed for apps: HTTP ${response.status.toString()}\n${body}`,
    );
  }
  const latest = latestPublishedVersion(await response.json());
  if (latest === undefined) {
    throw new Error("ChartMuseum has no published apps release");
  }
  if (latest.version !== expectedRevision) {
    throw new Error(
      `Refusing stale Argo release ${expectedRevision}: newest published apps revision is ${latest.version}`,
    );
  }
}

async function assertRootPruneSafe(token: string): Promise<void> {
  const root = await getApplication("apps", token);
  const status = isRecord(root["status"]) ? root["status"] : {};
  const resources = Array.isArray(status["resources"])
    ? status["resources"]
    : [];
  const candidates = resources.flatMap((resource: unknown) => {
    if (
      !isRecord(resource) ||
      resource["kind"] !== "Application" ||
      resource["status"] !== "OutOfSync" ||
      typeof resource["name"] !== "string" ||
      resource["name"] === "apps"
    ) {
      return [];
    }
    return [resource["name"]];
  });
  for (const childName of candidates) {
    const child = await getApplication(childName, token);
    const metadata = isRecord(child["metadata"]) ? child["metadata"] : {};
    const annotations = isRecord(metadata["annotations"])
      ? metadata["annotations"]
      : {};
    const finalizers = Array.isArray(metadata["finalizers"])
      ? metadata["finalizers"]
      : [];
    const lifecycle = annotations[APPLICATION_LIFECYCLE_ANNOTATION];
    if (lifecycle !== "cascade") {
      throw new Error(
        `Refusing to prune Application ${childName}: lifecycle is ${String(lifecycle ?? "undeclared")}`,
      );
    }
    if (!finalizers.includes(APPLICATION_RESOURCES_FINALIZER)) {
      throw new Error(
        `Refusing to prune Application ${childName}: cascading resources finalizer is missing`,
      );
    }
  }
}

/**
 * Trigger an ArgoCD sync for an application and wait for the sync OPERATION to
 * reach a terminal phase, failing on anything but Succeeded.
 *
 * The POST only starts the operation; its result lands asynchronously in
 * `status.operationState`. Returning on POST success let a failed operation
 * (e.g. an unreachable kyverno admission webhook rejecting every apply) pass
 * this step and surface two steps later as a tofu tunnel-gate timeout with a
 * misleading symptom (build 5748). Failing here puts the error at the step
 * that caused it, where Buildkite's automatic retry re-syncs through
 * transient webhook downtime.
 */
type SyncOptions = {
  prune: boolean;
  revision?: string;
  manifests?: readonly string[];
  resources?: readonly SyncOperationResource[];
};

async function sync(
  appName: string,
  timeoutSeconds: number,
  dryRun: boolean,
  options: SyncOptions,
): Promise<void> {
  console.log(
    `--- argocd sync: ${appName}${options.prune ? " (prune)" : ""}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would POST sync for ArgoCD app ${appName}${options.prune ? " with pruning" : ""}`,
    );
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  if (appName === "apps" && options.prune) {
    await assertRootPruneSafe(token);
  }
  const requestId = crypto.randomUUID();
  const url = `${serverUrl()}/api/v1/applications/${appName}/sync`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prune: options.prune,
      infos: [{ name: SYNC_REQUEST_ID_INFO_NAME, value: requestId }],
      ...(options.revision === undefined ? {} : { revision: options.revision }),
      ...(options.manifests === undefined
        ? {}
        : { manifests: options.manifests }),
      ...(options.resources === undefined
        ? {}
        : { resources: options.resources }),
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 1024);
    throw new Error(
      `Sync failed: HTTP ${res.status.toString()} ${res.statusText}\n${body}`,
    );
  }
  const operationIdentity = requestedOperationIdentity(await res.json());
  console.log(`sync operation started: ${appName}`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const app = await getApplication(appName, token);
    const status = isRecord(app["status"]) ? app["status"] : {};
    const op = isRecord(status["operationState"])
      ? status["operationState"]
      : {};
    const phase = typeof op["phase"] === "string" ? op["phase"] : "";
    const isOurs = completedOperationIdentity(app) === operationIdentity;
    console.log(
      `Operation: ${phase || "(pending)"}${isOurs ? "" : " [previous op]"} ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (isOurs && phase === "Succeeded") {
      console.log(`synced: ${appName}`);
      return;
    }
    if (isOurs && (phase === "Failed" || phase === "Error")) {
      const message = typeof op["message"] === "string" ? op["message"] : "";
      throw new Error(
        `Sync operation ${phase} for ${appName}: ${message.slice(0, 1024)}`,
      );
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS / 1000;
  }
  throw new Error(
    `Timeout: sync operation for ${appName} did not complete within ${timeoutSeconds.toString()}s`,
  );
}

async function reconcileRelease(
  expectedPath: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  const expected = ExpectedApplicationsSchema.parse(
    JSON.parse(await Bun.file(expectedPath).text()),
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would reconcile ${expected.length.toString()} expected Application(s)`,
    );
    return;
  }
  const appsRelease = expected.find(
    (application) => application.name === "apps",
  );
  if (appsRelease === undefined) {
    throw new Error("Expected release inventory is missing the apps revision");
  }
  await assertExpectedAppsRevisionIsLatest(appsRelease.revision);
  const token = requireEnv("ARGOCD_TOKEN");
  const root = ReconcileApplicationSchema.parse(
    await getApplication("apps", token),
  );
  if (
    root.status?.sync?.status !== "Synced" ||
    root.status.sync.revision !== appsRelease.revision
  ) {
    await sync("apps", timeoutSeconds, false, {
      prune: false,
      revision: appsRelease.revision,
    });
  }
  for (const wanted of expected) {
    if (wanted.name === "apps") {
      continue;
    }
    const current = ReconcileApplicationSchema.parse(
      await getApplication(wanted.name, token),
    );
    const syncStatus = current.status?.sync?.status;
    const revision = current.status?.sync?.revision;
    if (
      syncStatus === "Synced" &&
      (wanted.revision === undefined || revision === wanted.revision)
    ) {
      continue;
    }
    await sync(wanted.name, timeoutSeconds, false, {
      prune: wanted.prune,
      revision: wanted.revision,
    });
  }
  await releaseHealthWait(expectedPath, timeoutSeconds, false);
}

async function releaseHealthWait(
  expectedPath: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  const expected = ExpectedApplicationsSchema.parse(
    JSON.parse(await Bun.file(expectedPath).text()),
  );
  console.log(
    `--- argocd release-health-wait: ${expected.length.toString()} expected Application(s)`,
  );
  if (dryRun) {
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latestFailures: readonly string[] = [];
  while (Date.now() < deadline) {
    const readiness = releaseTreeReadiness(
      await getApplications(token),
      expected,
    );
    if (readiness.ready) {
      console.log("release tree is Synced/Healthy on expected revisions");
      return;
    }
    latestFailures = readiness.failures;
    for (const failure of latestFailures) {
      console.log(`not ready: ${failure}`);
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Release tree did not become ready: ${latestFailures.join("; ")}`,
  );
}

/**
 * Delete an ArgoCD child Application with foreground cascading deletion, then
 * wait for the Application object to disappear. A missing application is
 * already in the desired state, which keeps teardown reruns idempotent.
 */
async function deleteApplication(
  appName: string,
  project: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  console.log(
    `--- argocd delete-application: ${project}/${appName}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would foreground-cascade delete ArgoCD app ${project}/${appName}`,
    );
    return;
  }

  const token = requireEnv("ARGOCD_TOKEN");
  const url = new URL(
    `/api/v1/applications/${encodeURIComponent(appName)}`,
    serverUrl(),
  );
  url.searchParams.set("cascade", "true");
  url.searchParams.set("propagationPolicy", "foreground");
  // Argo CD intentionally returns HTTP 403 for a missing Application when the
  // project is omitted. Fully scoping the request lets an authorized caller
  // receive HTTP 404 and keeps repeated teardown runs idempotent.
  url.searchParams.set("project", project);
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      // Argo CD versions before argoproj/argo-cd#23028 validate Content-Type
      // even for body-less DELETE requests and otherwise return HTTP 415.
      "Content-Type": "application/json",
    },
  });
  if (res.status !== 404 && !res.ok) {
    const body = (await res.text()).slice(0, 1024);
    throw new Error(
      `Application deletion failed: HTTP ${res.status.toString()} ${res.statusText}\n${body}`,
    );
  }
  if (res.status === 404) {
    console.log(`already deleted: ${appName}`);
    return;
  }

  const getUrl = new URL(
    `/api/v1/applications/${encodeURIComponent(appName)}`,
    serverUrl(),
  );
  getUrl.searchParams.set("project", project);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    if (getRes.status === 404) {
      console.log(`deleted: ${appName}`);
      return;
    }
    if (getRes.status !== 200) {
      const body = (await getRes.text()).slice(0, 1024);
      throw new Error(
        `ERROR: ${getUrl} returned HTTP ${getRes.status.toString()}\n` +
          `Response body (first 1KB): ${body}`,
      );
    }
    console.log(
      `${appName}: deletion pending ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    await Bun.sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS / 1000;
  }
  throw new Error(
    `Timeout: ${appName} was not deleted within ${timeoutSeconds.toString()}s`,
  );
}

/** Poll until an application satisfies the selected readiness gate. */
async function healthWait(
  appName: string,
  timeoutSeconds: number,
  dryRun: boolean,
  requireSynced: boolean,
): Promise<void> {
  const subcommand = requireSynced ? "tree-health-wait" : "health-wait";
  const requirement = requireSynced ? "Synced/Healthy" : "Healthy";
  console.log(
    `--- argocd ${subcommand}: ${appName}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would wait for ArgoCD app ${appName} to be ${requirement}`,
    );
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const app = await getApplication(appName, token);
    const readiness = applicationReadiness(app, requireSynced);
    console.log(
      `Sync: ${readiness.sync || "(unknown)"}; ` +
        `Health: ${readiness.health || "(unknown)"} ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (readiness.ready) {
      console.log(`${requirement.toLowerCase()}: ${appName}`);
      return;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS / 1000;
  }
  // Name the culprits before failing: the bare timeout message forced manual
  // kubectl archaeology on every incident wait (builds 6296–6333). Diagnostics
  // only — a listing failure is logged loudly and the timeout still throws.
  try {
    const url = `${serverUrl()}/api/v1/applications`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    if (res.status === 200) {
      for (const line of unreadyApplicationSummaries(
        await res.json(),
        requireSynced,
      )) {
        console.error(`not ${requirement}: ${line}`);
      }
    } else {
      console.error(
        `diagnostics listing failed: ${url} returned HTTP ${res.status.toString()}`,
      );
    }
  } catch (error) {
    console.error("diagnostics listing failed:", error);
  }
  throw new Error(
    `Timeout: ${appName} did not become ${requirement} within ${timeoutSeconds.toString()}s`,
  );
}

/**
 * Poll ArgoCD's resource tree until no resource matching group/version/kind/
 * namespace remains (i.e. the finalizer has run and the K8s object is gone).
 * Filters by GVK+namespace rather than an exact name because cdk8s ApiObjects
 * get hash-suffixed names once nested under a Chart, so a guessed name would
 * not match and this gate would 404 as "already deleted" prematurely.
 */
async function waitDeletion(opts: {
  appName: string;
  group: string;
  version: string;
  kind: string;
  namespace: string;
  timeoutSeconds: number;
  dryRun: boolean;
}): Promise<void> {
  const { appName, group, version, kind, namespace, timeoutSeconds, dryRun } =
    opts;
  const label = `${kind} (group=${group}, ns=${namespace})`;
  console.log(
    `--- argocd wait-deletion: ${label} in ${appName}` +
      (dryRun ? " (dry run)" : ""),
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would wait for all ${label} to be deleted from app ${appName}`,
    );
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const app = await getApplication(appName, token);
    const status = isRecord(app["status"]) ? app["status"] : {};
    const resources = Array.isArray(status["resources"])
      ? status["resources"]
      : [];
    const remaining = resources.filter((r: unknown) => {
      if (!isRecord(r)) {
        return false;
      }
      return (
        r["group"] === group &&
        r["version"] === version &&
        r["kind"] === kind &&
        r["namespace"] === namespace
      );
    }).length;
    console.log(
      `${label}: ${remaining.toString()} remaining ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (remaining === 0) {
      console.log(`${label} is fully deleted.`);
      return;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS / 1000;
  }
  throw new Error(
    `Timeout: ${label} was not fully deleted within ${timeoutSeconds.toString()}s`,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage:\n" +
      "  bun packages/homelab/scripts/argocd.ts sync <app> " +
      "[--prune] [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts delete-application <app> " +
      "--project <project> [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts health-wait <app> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts tree-health-wait <app> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts release-health-wait <expected.json> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts reconcile-release <expected.json> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts suspend-auto-sync <root-app> " +
      "[--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts wait-deletion <app> " +
      "--group <g> --version <v> --kind <k> --namespace <ns> " +
      "[--timeout <s>] [--dry-run]",
  );
  process.exit(1);
}

/** Read a named `--flag value` option from argv, or undefined if absent. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) {
    return undefined;
  }
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`--${name} requires a value`);
    usage();
  }
  return v;
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    usage();
  }
  const dryRun = argv.includes("--dry-run");
  const subcommand = argv[0];
  const app = argv[1];
  if (app === undefined || app.startsWith("--")) {
    console.error("An application name is required.");
    usage();
  }

  const timeoutStr = flag(argv, "timeout");
  const timeoutOverride =
    timeoutStr === undefined ? undefined : Number.parseInt(timeoutStr, 10);
  if (timeoutOverride !== undefined && Number.isNaN(timeoutOverride)) {
    console.error(`--timeout must be an integer, got: ${String(timeoutStr)}`);
    usage();
  }

  switch (subcommand) {
    case "sync": {
      const revision = flag(argv, "revision");
      await sync(app, timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S, dryRun, {
        prune: argv.includes("--prune"),
        ...(revision === undefined ? {} : { revision }),
      });
      return;
    }
    case "delete-application": {
      const project = flag(argv, "project");
      if (project === undefined) {
        console.error("--project is required for delete-application.");
        usage();
      }
      await deleteApplication(
        app,
        project,
        timeoutOverride ?? DEFAULT_DELETION_TIMEOUT_S,
        dryRun,
      );
      return;
    }
    case "health-wait":
      await healthWait(
        app,
        timeoutOverride ?? DEFAULT_HEALTH_TIMEOUT_S,
        dryRun,
        false,
      );
      return;
    case "tree-health-wait":
      await healthWait(
        app,
        timeoutOverride ?? DEFAULT_HEALTH_TIMEOUT_S,
        dryRun,
        true,
      );
      return;
    case "release-health-wait":
      await releaseHealthWait(
        app,
        timeoutOverride ?? DEFAULT_HEALTH_TIMEOUT_S,
        dryRun,
      );
      return;
    case "reconcile-release":
      await reconcileRelease(
        app,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
      );
      return;
    case "suspend-auto-sync":
      await suspendRepositoryAutoSync(
        app,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
      );
      return;
    case "wait-deletion": {
      const group = flag(argv, "group");
      const version = flag(argv, "version");
      const kind = flag(argv, "kind");
      const namespace = flag(argv, "namespace");
      if (
        group === undefined ||
        version === undefined ||
        kind === undefined ||
        namespace === undefined
      ) {
        console.error(
          "wait-deletion requires --group, --version, --kind, and --namespace",
        );
        usage();
      }
      await waitDeletion({
        appName: app,
        group,
        version,
        kind,
        namespace,
        timeoutSeconds: timeoutOverride ?? DEFAULT_DELETION_TIMEOUT_S,
        dryRun,
      });
      return;
    }
    default:
      console.error(`Unknown subcommand: ${String(subcommand)}`);
      usage();
  }
}

await runMain(main);
