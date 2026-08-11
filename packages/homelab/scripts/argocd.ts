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
 *   bun packages/homelab/scripts/argocd.ts sync <app> [--revision <v>]
 *       [--prune] [--async | --terminate-after-applied]
 *       [--request-id <uuid>] [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts finalize-async-sync <app> \
 *       --revision <v> --request-id <uuid> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts delete-application <app> \
 *       --project <project> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts health-wait <app> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts tree-health-wait <app> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts suspend-auto-sync <root-app> \
 *       [--revision <v>] [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts wait-deletion <app> \
 *       --group <g> --version <v> --kind <k> --namespace <ns> \
 *       [--timeout <s>] [--dry-run]
 *
 * Env:
 *   ARGOCD_TOKEN     — ArgoCD API bearer token (required unless --dry-run)
 *   ARGOCD_SERVER_URL — optional, defaults to https://argocd.sjer.red
 *   ARGOCD_POLL_INTERVAL_MS — optional polling interval override for tests
 */

import { requireEnv, optionalEnv } from "../../../scripts/lib/run.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";
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
  activeOperationRequestId,
  batchManifestOverrides,
  completedOperationRequestId,
  requestedOperationRequestId,
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
const CHARTMUSEUM_MAX_ATTEMPTS = 3;
const CHARTMUSEUM_REQUEST_TIMEOUT_MS = 10_000;
const CHARTMUSEUM_RETRY_BASE_DELAY_MS = 100;

const BuildRevisionSchema = z.string().regex(/^2\.0\.0-\d+$/);
const SyncRequestIdSchema = z.uuid();
const PollIntervalSchema = z.coerce.number().int().positive();

const ExpectedApplicationsSchema = z.array(
  z.object({
    name: z.string().min(1),
    revision: BuildRevisionSchema,
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
          targetRevision: z.string().min(1),
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

const RootDeploymentHistorySchema = z.object({
  status: z.object({
    history: z
      .array(
        z.object({
          id: z.number().int().nonnegative(),
          revision: z.string().regex(/^2\.0\.0-\d+$/),
        }),
      )
      .min(1),
  }),
});

const ReconcileApplicationSchema = z.object({
  status: z
    .object({
      sync: z
        .object({
          status: z.string(),
          revision: z.string().optional(),
        })
        .optional(),
      operationState: z
        .object({
          phase: z.string(),
          syncResult: z.object({ revision: z.string().optional() }).optional(),
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

async function getApplicationManifests(
  appName: string,
  revision: string,
  token: string,
): Promise<readonly string[]> {
  const manifestsUrl = new URL(
    `/api/v1/applications/${encodeURIComponent(appName)}/manifests`,
    serverUrl(),
  );
  manifestsUrl.searchParams.set("revision", revision);
  const response = await fetch(manifestsUrl, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1024);
    throw new Error(
      `Could not render ${appName} from ${manifestsUrl.toString()}: ` +
        `HTTP ${response.status.toString()}\n${body}`,
    );
  }
  return ManifestResponseSchema.parse(await response.json()).manifests;
}

async function suspendRepositoryAutoSync(
  rootAppName: string,
  timeoutSeconds: number,
  dryRun: boolean,
  revision: string | undefined,
): Promise<void> {
  const exactRevision =
    revision === undefined ? undefined : BuildRevisionSchema.parse(revision);
  console.log(
    `--- argocd suspend-auto-sync: repository Applications under ${rootAppName}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    return;
  }
  if (exactRevision !== undefined) {
    await assertExpectedAppsRevisionIsLatest(exactRevision, timeoutSeconds);
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const renderedRevision =
    exactRevision === undefined
      ? latestSuccessfulRevision(
          rootAppName,
          RootDeploymentHistorySchema.parse(
            await getApplication(rootAppName, token),
          ),
        )
      : exactRevision;
  const manifests = await getApplicationManifests(
    rootAppName,
    renderedRevision,
    token,
  );
  const suspended = manifests.flatMap((manifestSource) => {
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
    const automated = application.spec.syncPolicy["automated"];
    if (!isRecord(automated)) {
      return [];
    }
    const syncPolicy = {
      ...application.spec.syncPolicy,
      automated: { ...automated, enabled: false },
    };
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

function latestSuccessfulRevision(
  rootAppName: string,
  rootApplication: z.infer<typeof RootDeploymentHistorySchema>,
): string {
  const [firstDeployment, ...remainingDeployments] =
    rootApplication.status.history;
  if (firstDeployment === undefined) {
    throw new Error(`${rootAppName} has no successful deployment history`);
  }
  return remainingDeployments.reduce(
    (latest, candidate) => (candidate.id > latest.id ? candidate : latest),
    firstDeployment,
  ).revision;
}

async function assertExpectedAppsRevisionIsLatest(
  expectedRevision: string,
  timeoutSeconds: number,
): Promise<void> {
  const url = `${chartMuseumOrigin()}/api/charts/apps`;
  const response = await fetchChartMuseumInventory(url, timeoutSeconds);
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

async function fetchChartMuseumInventory(
  url: string,
  timeoutSeconds: number,
): Promise<Response> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastFailure = "request deadline expired";
  let lastCause: unknown;
  for (let attempt = 1; attempt <= CHARTMUSEUM_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(
          Math.min(CHARTMUSEUM_REQUEST_TIMEOUT_MS, remainingMs),
        ),
      });
    } catch (error) {
      lastCause = error;
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (response !== undefined) {
      if (response.ok) {
        return response;
      }
      const body = (await response.text()).slice(0, 1024);
      lastFailure = `HTTP ${response.status.toString()}\n${body}`;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(
          `ChartMuseum inventory failed for apps: ${lastFailure}`,
        );
      }
    }
    if (attempt < CHARTMUSEUM_MAX_ATTEMPTS) {
      const delayMs = Math.min(
        CHARTMUSEUM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        Math.max(0, deadline - Date.now()),
      );
      if (delayMs > 0) {
        console.warn(
          `ChartMuseum inventory attempt ${attempt.toString()} failed; retrying in ${delayMs.toString()}ms`,
        );
        await Bun.sleep(delayMs);
      }
    }
  }
  throw new TransientError(
    `ChartMuseum inventory failed for apps after ${CHARTMUSEUM_MAX_ATTEMPTS.toString()} attempts: ${lastFailure}`,
    { cause: lastCause },
  );
}

async function assertRootPruneSafe(
  token: string,
  revision: string,
): Promise<void> {
  const exactRevision = BuildRevisionSchema.parse(revision);
  const desiredChildren = new Set(
    (await getApplicationManifests("apps", exactRevision, token)).flatMap(
      (manifestSource) => {
        const parsed = RenderedObjectSchema.parse(JSON.parse(manifestSource));
        if (parsed.kind !== "Application") {
          return [];
        }
        return [RenderedApplicationSchema.parse(parsed).metadata.name];
      },
    ),
  );
  const root = await getApplication("apps", token);
  const status = isRecord(root["status"]) ? root["status"] : {};
  const resources = Array.isArray(status["resources"])
    ? status["resources"]
    : [];
  const candidates = resources.flatMap((resource: unknown) => {
    if (
      !isRecord(resource) ||
      resource["kind"] !== "Application" ||
      typeof resource["name"] !== "string" ||
      resource["name"] === "apps" ||
      desiredChildren.has(resource["name"])
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
 * Trigger an ArgoCD sync and retain its identity through the requested
 * completion boundary.
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
  requestId?: string;
  terminateAfterApplied?: boolean;
  waitForCompletion?: boolean;
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
    if (options.revision === undefined) {
      throw new Error(
        "Root Application pruning requires an exact --revision so prune candidates can be verified against the rendered source",
      );
    }
    await assertRootPruneSafe(token, options.revision);
  }
  if (
    options.terminateAfterApplied === true &&
    options.revision === undefined
  ) {
    throw new Error("--terminate-after-applied requires an exact --revision");
  }
  const requestId = SyncRequestIdSchema.parse(
    options.requestId ?? crypto.randomUUID(),
  );
  const retryable =
    options.requestId !== undefined || options.terminateAfterApplied === true;
  let baseline: OperationObservation | undefined;
  let adopted = false;

  if (retryable) {
    baseline = observeOperation(await getApplication(appName, token));
    assertMatchingRevision(baseline, requestId, options.revision, appName);
    assertMatchingLiveRevision(baseline, requestId, options.revision, appName);
    if (baseline.hasLiveOperation) {
      if (!liveOperationMatches(baseline, requestId, options.revision)) {
        throw new Error(
          `Refusing to replace active ${appName} operation ${liveOperationDescription(baseline)}; expected request ${requestId}`,
        );
      }
      const completedOperationMatches = operationMatches(
        baseline,
        requestId,
        options.revision,
      );
      if (completedOperationMatches && baseline.phase === "Terminating") {
        if (
          options.terminateAfterApplied === true &&
          options.revision !== undefined &&
          syncResultApplied(baseline.state, options.revision)
        ) {
          await waitForOperationTermination(
            appName,
            token,
            requestId,
            options.revision,
            timeoutSeconds,
          );
          console.log(`sync operation already finalized: ${appName}`);
          return;
        }
        throw new Error(
          `Matching ${appName} operation is already Terminating before its result was accepted`,
        );
      }
      adopted = true;
      console.log(`adopted active sync operation: ${appName}`);
    }
  }

  if (!adopted) {
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
        ...(options.revision === undefined
          ? {}
          : { revision: options.revision }),
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
    const responseRequestId = requestedOperationRequestId(await res.json());
    if (responseRequestId !== requestId) {
      throw new Error(
        `Argo sync response returned request ${responseRequestId}; expected ${requestId}`,
      );
    }
    console.log(`sync operation started: ${appName}`);
  }
  if (options.waitForCompletion === false) {
    return;
  }
  await waitForIdentifiedOperation({
    appName,
    token,
    requestId,
    revision: options.revision,
    timeoutSeconds,
    baseline,
    exactOperationSeen: false,
    terminateAfterApplied: options.terminateAfterApplied === true,
  });
}

function operationState(app: Record<string, unknown>): Record<string, unknown> {
  const status = isRecord(app["status"]) ? app["status"] : {};
  return isRecord(status["operationState"]) ? status["operationState"] : {};
}

function operationRevision(
  operation: Record<string, unknown>,
): string | undefined {
  const sync = isRecord(operation["sync"]) ? operation["sync"] : {};
  const revision = sync["revision"];
  return typeof revision === "string" ? revision : undefined;
}

type OperationObservation = {
  readonly hasLiveOperation: boolean;
  readonly liveRequestId: string | null;
  readonly liveRevision: string | undefined;
  readonly phase: string;
  readonly requestId: string | null;
  readonly revision: string | undefined;
  readonly startedAt: string | undefined;
  readonly state: Record<string, unknown>;
};

function observeOperation(app: Record<string, unknown>): OperationObservation {
  const state = operationState(app);
  const completedOperation = isRecord(state["operation"])
    ? state["operation"]
    : undefined;
  const liveOperation = isRecord(app["operation"])
    ? app["operation"]
    : undefined;
  const phase = state["phase"];
  const startedAt = state["startedAt"];
  return {
    hasLiveOperation: liveOperation !== undefined,
    liveRequestId:
      liveOperation === undefined ? null : activeOperationRequestId(app),
    liveRevision:
      liveOperation === undefined
        ? undefined
        : operationRevision(liveOperation),
    phase: typeof phase === "string" ? phase : "",
    requestId: completedOperationRequestId(app),
    revision:
      completedOperation === undefined
        ? undefined
        : operationRevision(completedOperation),
    startedAt: typeof startedAt === "string" ? startedAt : undefined,
    state,
  };
}

function liveOperationMatches(
  operation: OperationObservation,
  requestId: string,
  revision: string | undefined,
): boolean {
  return (
    operation.hasLiveOperation &&
    operation.liveRequestId === requestId &&
    (revision === undefined || operation.liveRevision === revision)
  );
}

function operationMatches(
  operation: OperationObservation,
  requestId: string,
  revision: string | undefined,
): boolean {
  return (
    operation.requestId === requestId &&
    (revision === undefined || operation.revision === revision)
  );
}

function assertMatchingRevision(
  operation: OperationObservation,
  requestId: string,
  revision: string | undefined,
  appName: string,
): void {
  if (
    operation.requestId === requestId &&
    revision !== undefined &&
    operation.revision !== revision
  ) {
    throw new Error(
      `Refusing ${appName} operation for request ${requestId} at ${operation.revision ?? "unknown revision"}; expected ${revision}`,
    );
  }
}

function assertMatchingLiveRevision(
  operation: OperationObservation,
  requestId: string,
  revision: string | undefined,
  appName: string,
): void {
  if (
    operation.liveRequestId === requestId &&
    revision !== undefined &&
    operation.liveRevision !== revision
  ) {
    throw new Error(
      `Refusing active ${appName} operation for request ${requestId} at ${operation.liveRevision ?? "unknown revision"}; expected ${revision}`,
    );
  }
}

function operationDescription(operation: OperationObservation): string {
  return `${operation.requestId ?? "without a request ID"} at ${operation.revision ?? "unknown revision"}`;
}

function liveOperationDescription(operation: OperationObservation): string {
  return `${operation.liveRequestId ?? "without a request ID"} at ${operation.liveRevision ?? "unknown revision"}`;
}

function isActiveOperation(phase: string): boolean {
  return phase === "Running" || phase === "Terminating";
}

function operationChanged(
  before: OperationObservation,
  current: OperationObservation,
): boolean {
  return (
    before.requestId !== current.requestId ||
    before.revision !== current.revision ||
    before.startedAt !== current.startedAt ||
    before.phase !== current.phase ||
    JSON.stringify(before.state) !== JSON.stringify(current.state)
  );
}

function operationPollIntervalMs(): number {
  const configured = optionalEnv("ARGOCD_POLL_INTERVAL_MS");
  return configured === undefined
    ? POLL_INTERVAL_MS
    : PollIntervalSchema.parse(configured);
}

async function sleepUntilNextOperationPoll(deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining > 0) {
    await Bun.sleep(Math.min(operationPollIntervalMs(), remaining));
  }
}

function syncResultRevision(
  operationStateValue: Record<string, unknown>,
): string | undefined {
  const syncResult = isRecord(operationStateValue["syncResult"])
    ? operationStateValue["syncResult"]
    : {};
  const revision = syncResult["revision"];
  return typeof revision === "string" ? revision : undefined;
}

function syncResultApplied(
  operationStateValue: Record<string, unknown>,
  revision: string,
): boolean {
  if (syncResultRevision(operationStateValue) !== revision) {
    return false;
  }
  const syncResult = isRecord(operationStateValue["syncResult"])
    ? operationStateValue["syncResult"]
    : {};
  const resources = syncResult["resources"];
  if (!Array.isArray(resources) || resources.length === 0) {
    return false;
  }
  return resources.every((resource: unknown) => {
    if (!isRecord(resource)) {
      return false;
    }
    const status = resource["status"];
    const hookPhase = resource["hookPhase"];
    return (
      (status === "Synced" || status === "Pruned" || status === "Skipped") &&
      hookPhase !== "Failed" &&
      hookPhase !== "Error"
    );
  });
}

type WaitForIdentifiedOperationOptions = {
  readonly appName: string;
  readonly baseline: OperationObservation | undefined;
  readonly exactOperationSeen: boolean;
  readonly requestId: string;
  readonly revision: string | undefined;
  readonly terminateAfterApplied: boolean;
  readonly timeoutSeconds: number;
  readonly token: string;
};

async function waitForIdentifiedOperation({
  appName,
  baseline,
  exactOperationSeen: initiallySeen,
  requestId,
  revision,
  terminateAfterApplied,
  timeoutSeconds,
  token,
}: WaitForIdentifiedOperationOptions): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let exactOperationSeen = initiallySeen;
  while (Date.now() < deadline) {
    const current = observeOperation(await getApplication(appName, token));
    assertMatchingRevision(current, requestId, revision, appName);
    assertMatchingLiveRevision(current, requestId, revision, appName);
    const isExpected = operationMatches(current, requestId, revision);
    const isExpectedLiveOperation = liveOperationMatches(
      current,
      requestId,
      revision,
    );
    if (current.hasLiveOperation && !isExpectedLiveOperation) {
      throw new Error(
        `Active ${appName} operation changed to ${liveOperationDescription(current)} while waiting for request ${requestId}`,
      );
    }
    if (
      !exactOperationSeen &&
      isExpected &&
      (baseline === undefined || operationChanged(baseline, current))
    ) {
      exactOperationSeen = true;
    }
    const elapsed = Math.floor(
      (timeoutSeconds * 1000 - (deadline - Date.now())) / 1000,
    );
    console.log(
      `Operation: ${current.phase || "(pending)"}${exactOperationSeen && isExpected ? "" : " [previous op]"} ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (exactOperationSeen && isExpected) {
      if (current.phase === "Succeeded") {
        console.log(`synced: ${appName}`);
        return;
      }
      if (current.phase === "Failed" || current.phase === "Error") {
        const message = current.state["message"];
        throw new Error(
          `Sync operation ${current.phase} for ${appName}: ${typeof message === "string" ? message.slice(0, 1024) : ""}`,
        );
      }
      if (current.phase === "Terminating") {
        throw new Error(
          `Sync operation for ${appName} entered Terminating before this command finalized it`,
        );
      }
      if (
        terminateAfterApplied &&
        revision !== undefined &&
        isExpectedLiveOperation &&
        current.phase === "Running" &&
        syncResultApplied(current.state, revision)
      ) {
        await terminateAppliedOperation(
          appName,
          token,
          requestId,
          revision,
          timeoutSeconds,
        );
        return;
      }
    }
    await sleepUntilNextOperationPoll(deadline);
  }
  throw new Error(
    `Timeout: sync operation for ${appName} did not complete within ${timeoutSeconds.toString()}s`,
  );
}

async function waitForOperationTermination(
  appName: string,
  token: string,
  requestId: string,
  revision: string,
  timeoutSeconds: number,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const current = observeOperation(await getApplication(appName, token));
    assertMatchingRevision(current, requestId, revision, appName);
    assertMatchingLiveRevision(current, requestId, revision, appName);
    const isExpected = operationMatches(current, requestId, revision);
    const isExpectedLiveOperation = liveOperationMatches(
      current,
      requestId,
      revision,
    );
    if (current.hasLiveOperation && !isExpectedLiveOperation) {
      throw new Error(
        `${appName} operation changed to ${liveOperationDescription(current)} after terminating request ${requestId}`,
      );
    }
    const hasOperationState =
      current.phase !== "" ||
      current.requestId !== null ||
      current.revision !== undefined;
    if (!isExpected && hasOperationState) {
      throw new Error(
        `${appName} operation changed to ${operationDescription(current)} after terminating request ${requestId}`,
      );
    }
    if (
      !current.hasLiveOperation &&
      (!isExpected || !isActiveOperation(current.phase))
    ) {
      return;
    }
    await sleepUntilNextOperationPoll(deadline);
  }
  throw new Error(
    `Timeout: terminated ${appName} operation for request ${requestId} did not leave Running/Terminating state within ${timeoutSeconds.toString()}s`,
  );
}

async function terminateAppliedOperation(
  appName: string,
  token: string,
  requestId: string,
  revision: string,
  timeoutSeconds: number,
): Promise<void> {
  const url = new URL(
    `/api/v1/applications/${encodeURIComponent(appName)}/operation`,
    serverUrl(),
  );
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1024);
    throw new Error(
      `Async sync termination failed: HTTP ${response.status.toString()} ${response.statusText}\n${body}`,
    );
  }
  console.log(`terminated applied sync operation: ${appName}`);
  await waitForOperationTermination(
    appName,
    token,
    requestId,
    revision,
    timeoutSeconds,
  );
}

/**
 * Recover a root sync started by an earlier process after its manifests apply.
 *
 * ArgoCD's async flag only changes client-side waiting: the controller keeps
 * the operation Running until every resource is Healthy. The root app owns
 * Applications that are intentionally deferred or independently unhealthy, so
 * that health wait can outlive the release. Before terminating, require the
 * exact request ID, exact requested revision, and a complete successful sync
 * result; a missing, failed, or mismatched operation remains a hard failure.
 */
async function finalizeAsyncSync(
  appName: string,
  revision: string,
  requestId: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  const exactRevision = BuildRevisionSchema.parse(revision);
  const exactRequestId = SyncRequestIdSchema.parse(requestId);
  console.log(
    `--- argocd finalize-async-sync: ${appName} at ${exactRevision} for request ${exactRequestId}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would terminate the applied Running operation for ${appName} at ${exactRevision} for request ${exactRequestId}`,
    );
    return;
  }

  const token = requireEnv("ARGOCD_TOKEN");
  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const current = observeOperation(await getApplication(appName, token));
    assertMatchingRevision(current, exactRequestId, exactRevision, appName);
    assertMatchingLiveRevision(current, exactRequestId, exactRevision, appName);
    const isExpected = operationMatches(current, exactRequestId, exactRevision);
    const isExpectedLiveOperation = liveOperationMatches(
      current,
      exactRequestId,
      exactRevision,
    );
    if (current.hasLiveOperation && !isExpectedLiveOperation) {
      throw new Error(
        `Refusing to terminate active ${appName} operation ${liveOperationDescription(current)}; expected request ${exactRequestId} at ${exactRevision}`,
      );
    }
    if (
      isExpected &&
      !current.hasLiveOperation &&
      (current.phase === "Failed" || current.phase === "Error")
    ) {
      const message = current.state["message"];
      throw new Error(
        `Async sync operation ${current.phase} for ${appName} at ${exactRevision}: ${typeof message === "string" ? message.slice(0, 1024) : ""}`,
      );
    }
    if (
      isExpected &&
      !current.hasLiveOperation &&
      current.phase === "Succeeded"
    ) {
      console.log(`async sync operation already finalized: ${appName}`);
      return;
    }
    console.log(
      `Operation: ${current.phase || "(pending)"}${isExpected ? "" : " [previous op]"}; ` +
        `applied=${isExpected && syncResultApplied(current.state, exactRevision) ? "true" : "false"} ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (isExpected && current.phase === "Terminating") {
      if (!syncResultApplied(current.state, exactRevision)) {
        throw new Error(
          `Matching ${appName} operation entered Terminating before its result was fully applied`,
        );
      }
      await waitForOperationTermination(
        appName,
        token,
        exactRequestId,
        exactRevision,
        timeoutSeconds,
      );
      return;
    }
    if (
      isExpected &&
      isExpectedLiveOperation &&
      current.phase === "Running" &&
      syncResultApplied(current.state, exactRevision)
    ) {
      await terminateAppliedOperation(
        appName,
        token,
        exactRequestId,
        exactRevision,
        timeoutSeconds,
      );
      return;
    }
    await sleepUntilNextOperationPoll(deadline);
    elapsed = Math.floor(
      (timeoutSeconds * 1000 - (deadline - Date.now())) / 1000,
    );
  }
  throw new Error(
    `Timeout: ${appName} operation for request ${exactRequestId} at ${exactRevision} was not fully applied within ${timeoutSeconds.toString()}s`,
  );
}

async function reconcileRelease(
  expectedPath: string,
  timeoutSeconds: number,
  dryRun: boolean,
  deferredApps: ReadonlySet<string>,
  waitForHealth: boolean,
): Promise<void> {
  const expected = ExpectedApplicationsSchema.parse(
    JSON.parse(await Bun.file(expectedPath).text()),
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would reconcile ${expected.length.toString()} expected Application(s)` +
        (deferredApps.size === 0
          ? ""
          : `; defer ${[...deferredApps].join(", ")}`),
    );
    return;
  }
  const appsRelease = expected.find(
    (application) => application.name === "apps",
  );
  if (appsRelease === undefined) {
    throw new Error("Expected release inventory is missing the apps revision");
  }
  await assertExpectedAppsRevisionIsLatest(
    appsRelease.revision,
    timeoutSeconds,
  );
  const token = requireEnv("ARGOCD_TOKEN");
  // The release step handles the root Application with the subsequent atomic
  // sync. Waiting for it here would make every release depend on unrelated
  // child Application health.
  for (const wanted of expected) {
    if (wanted.name === "apps" || deferredApps.has(wanted.name)) {
      continue;
    }
    const current = ReconcileApplicationSchema.parse(
      await getApplication(wanted.name, token),
    );
    const syncStatus = current.status?.sync?.status;
    const revision = current.status?.sync?.revision;
    const operationPhase = current.status?.operationState?.phase;
    const operationRevision =
      current.status?.operationState?.syncResult?.revision;
    const failedCurrentOperation =
      (operationPhase === "Failed" || operationPhase === "Error") &&
      (operationRevision === undefined || operationRevision === revision);
    if (
      syncStatus === "Synced" &&
      (wanted.revision === undefined || revision === wanted.revision) &&
      !failedCurrentOperation
    ) {
      continue;
    }
    await sync(wanted.name, timeoutSeconds, false, {
      prune: wanted.prune,
      revision: wanted.revision,
    });
  }
  if (waitForHealth) {
    await releaseHealthWait(expectedPath, timeoutSeconds, false);
  }
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
      "[--revision <v>] [--prune] [--async | --terminate-after-applied] " +
      "[--request-id <uuid>] [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts delete-application <app> " +
      "--project <project> [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts health-wait <app> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts tree-health-wait <app> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts release-health-wait <expected.json> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts reconcile-release <expected.json> " +
      "[--defer-apps <app,...>] [--skip-health-wait] " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts finalize-async-sync <app> " +
      "--revision <v> --request-id <uuid> [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts suspend-auto-sync <root-app> " +
      "[--revision <v>] [--timeout <s>] [--dry-run]\n" +
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

function appList(raw: string | undefined): ReadonlySet<string> {
  if (raw === undefined) {
    return new Set();
  }
  const apps = raw.split(",").map((app) => app.trim());
  if (apps.some((app) => app.length === 0)) {
    console.error("--defer-apps must contain only comma-separated names");
    usage();
  }
  return new Set(apps);
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
      const requestId = flag(argv, "request-id");
      const asyncSync = argv.includes("--async");
      const terminateAfterApplied = argv.includes("--terminate-after-applied");
      if (asyncSync && terminateAfterApplied) {
        console.error(
          "--async and --terminate-after-applied cannot be combined.",
        );
        usage();
      }
      if (terminateAfterApplied && revision === undefined) {
        console.error(
          "--terminate-after-applied requires an exact --revision.",
        );
        usage();
      }
      if (requestId !== undefined && revision === undefined) {
        console.error("--request-id requires an exact --revision.");
        usage();
      }
      const exactRequestId =
        requestId === undefined
          ? undefined
          : SyncRequestIdSchema.parse(requestId);
      await sync(app, timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S, dryRun, {
        prune: argv.includes("--prune"),
        waitForCompletion: !asyncSync,
        terminateAfterApplied,
        ...(revision === undefined ? {} : { revision }),
        ...(exactRequestId === undefined ? {} : { requestId: exactRequestId }),
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
        appList(flag(argv, "defer-apps")),
        !argv.includes("--skip-health-wait"),
      );
      return;
    case "finalize-async-sync": {
      const revision = flag(argv, "revision");
      const requestId = flag(argv, "request-id");
      if (revision === undefined || requestId === undefined) {
        console.error(
          "--revision and --request-id are required for finalize-async-sync.",
        );
        usage();
      }
      await finalizeAsyncSync(
        app,
        revision,
        requestId,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
      );
      return;
    }
    case "suspend-auto-sync":
      await suspendRepositoryAutoSync(
        app,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
        flag(argv, "revision"),
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
