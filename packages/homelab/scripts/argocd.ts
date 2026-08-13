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
 *   bun packages/homelab/scripts/argocd.ts sync-managed <app> [--revision <v>]
 *       [--prune] [--terminate-after-applied]
 *       [--request-id <uuid>] [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts release-root apps <expected.json> \
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
  activeOperationId,
  activeOperationRequestId,
  batchManifestOverrides,
  completedOperationId,
  completedOperationRequestId,
  operationRevision,
  RELEASE_PHASE_INFO_NAME,
  requestedOperationId,
  requestedOperationRequestId,
  requestedOperationRevision,
  SYNC_OPERATION_ID_INFO_NAME,
  SYNC_REQUEST_ID_INFO_NAME,
  SYNC_REVISION_INFO_NAME,
  type ManifestOverride,
  type ManifestOverrideBatch,
  type ReleasePhase,
  type SyncOperationResource,
} from "./argocd-manifest-overrides.ts";
import { latestPublishedVersion } from "./helm-release-core.ts";
import {
  analyzeApplySafety,
  ManagedResourcesSchema,
  type ManagedResource,
} from "./argocd-apply-safety.ts";
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
const SyncOperationIdSchema = z.uuid();
const ReleasePhaseSchema = z.enum(["stage", "batch", "prune", "child"]);
const OperationStartedAtSchema = z.iso.datetime({ offset: true }).optional();
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

const ApplicationSourceSchema = z
  .object({
    repoURL: z.string(),
    chart: z.string().optional(),
    targetRevision: z.string().min(1),
  })
  .loose();

const RenderedApplicationSchema = z
  .object({
    apiVersion: z.string(),
    kind: z.literal("Application"),
    metadata: z
      .object({
        name: z.string(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .passthrough(),
    spec: z
      .object({
        source: ApplicationSourceSchema,
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

const RenderedResourceSchema = z.object({
  apiVersion: z.string().min(1),
  kind: z.string().min(1),
  metadata: z
    .object({
      name: z.string().min(1),
      namespace: z.string().min(1).optional(),
    })
    .passthrough(),
});

const ActiveOperationResourceSchema = z.object({
  group: z.string().optional(),
  kind: z.string().min(1),
  name: z.string().min(1),
});

const OperationInfoEntriesSchema = z
  .object({
    info: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  })
  .loose();

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
      history: z
        .array(
          z.object({
            id: z.number().int().nonnegative(),
            revision: z.string().min(1),
            source: ApplicationSourceSchema.optional(),
          }),
        )
        .optional(),
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

type ExpectedApplication = z.infer<typeof ExpectedApplicationsSchema>[number];

type ReleaseReconciliationTarget = {
  readonly name: string;
  readonly order: number;
  readonly prune: boolean;
  readonly repositoryRelease: boolean;
  readonly revision: string;
  readonly source: z.infer<typeof ApplicationSourceSchema>;
  readonly wave: number;
};

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
  refresh?: "hard",
): Promise<Record<string, unknown>> {
  const url = new URL(
    `/api/v1/applications/${encodeURIComponent(appName)}`,
    serverUrl(),
  );
  if (refresh !== undefined) {
    url.searchParams.set("refresh", refresh);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (res.status !== 200) {
    const body = (await res.text()).slice(0, 1024);
    throw new Error(
      `ERROR: ${url.toString()} returned HTTP ${res.status.toString()}\n` +
        `Response body (first 1KB): ${body}`,
    );
  }
  const data: unknown = await res.json();
  if (!isRecord(data)) {
    throw new Error(`${url.toString()} returned a non-object body`);
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

type RenderedTarget = {
  readonly manifest: string;
  readonly namespace: string | undefined;
};

function renderedTargetsByIdentity(
  manifests: readonly string[],
): ReadonlyMap<string, readonly RenderedTarget[]> {
  const targets = new Map<string, RenderedTarget[]>();
  for (const manifestSource of manifests) {
    const resource = RenderedResourceSchema.parse(JSON.parse(manifestSource));
    const separator = resource.apiVersion.indexOf("/");
    const identity = resourceIdentity(
      separator === -1 ? "" : resource.apiVersion.slice(0, separator),
      resource.kind,
      resource.metadata.name,
    );
    const rendered = targets.get(identity) ?? [];
    rendered.push({
      manifest: manifestSource,
      namespace: resource.metadata.namespace,
    });
    targets.set(identity, rendered);
  }
  return targets;
}

/**
 * A rendered manifest may omit the namespace an Application's destination
 * supplies, so an unnamespaced rendering matches a live namespaced resource.
 * Anything more ambiguous than that would silently preflight the wrong target.
 */
function renderedTargetState(
  targets: ReadonlyMap<string, readonly RenderedTarget[]>,
  resource: ManagedResource,
  appName: string,
): string | undefined {
  const identity = resourceIdentity(
    resource.group ?? "",
    resource.kind,
    resource.name,
  );
  const candidates = targets.get(identity) ?? [];
  const matches = candidates.filter(
    ({ namespace }) =>
      namespace === undefined || namespace === resource.namespace,
  );
  if (matches.length > 1) {
    throw new Error(
      `Apply-safety preflight for ${appName} matched ${identity} to ${matches.length.toString()} rendered manifests`,
    );
  }
  return matches[0]?.manifest;
}

/**
 * `managed-resources` reports the target state of the Application's configured
 * revision, so a sync that requests a different revision must be preflighted
 * against that revision's rendered manifests instead. A resource the requested
 * revision no longer declares is a prune, not an apply, so it carries no target.
 */
async function revisionScopedResources(
  appName: string,
  revision: string,
  token: string,
  resources: readonly ManagedResource[],
): Promise<readonly ManagedResource[]> {
  const targets = renderedTargetsByIdentity(
    await getApplicationManifests(appName, revision, token),
  );
  return resources.map((resource) => {
    const manifest = renderedTargetState(targets, resource, appName);
    return {
      kind: resource.kind,
      name: resource.name,
      ...(resource.group === undefined ? {} : { group: resource.group }),
      ...(resource.namespace === undefined
        ? {}
        : { namespace: resource.namespace }),
      ...(resource.liveState === undefined
        ? {}
        : { liveState: resource.liveState }),
      ...(manifest === undefined ? {} : { targetState: manifest }),
    };
  });
}

async function assertApplySafe(
  appName: string,
  token: string,
  revision: string | undefined,
): Promise<void> {
  await getApplication(appName, token, "hard");
  const url = new URL(
    `/api/v1/applications/${encodeURIComponent(appName)}/managed-resources`,
    serverUrl(),
  );
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1024);
    throw new Error(
      `Could not inspect apply safety for ${appName}: HTTP ${response.status.toString()} ${response.statusText}\n${body}`,
    );
  }
  const managed = ManagedResourcesSchema.parse(await response.json()).items;
  const findings = analyzeApplySafety(
    revision === undefined
      ? managed
      : await revisionScopedResources(appName, revision, token, managed),
  );
  if (findings.length > 0) {
    throw new Error(
      `Refusing ${appName} sync because the read-only apply-safety preflight found:\n${findings.map((finding) => `- ${finding}`).join("\n")}`,
    );
  }
}

function resourceIdentity(group: string, kind: string, name: string): string {
  return JSON.stringify([group, kind, name]);
}

function renderedResourceIdentity(manifestSource: string): string {
  const resource = RenderedResourceSchema.parse(JSON.parse(manifestSource));
  const separator = resource.apiVersion.indexOf("/");
  const group = separator === -1 ? "" : resource.apiVersion.slice(0, separator);
  return resourceIdentity(group, resource.kind, resource.metadata.name);
}

function renderedResourceIdentities(
  manifests: readonly string[],
): ReadonlySet<string> {
  const identities = manifests.map(renderedResourceIdentity);
  if (identities.length === 0) {
    throw new Error("Rendered sync source contains no resources");
  }
  const unique = new Set(identities);
  if (unique.size !== identities.length) {
    throw new Error(
      "Rendered sync source contains duplicate group/kind/name identities",
    );
  }
  return unique;
}

function operationResourceIdentities(
  resources: readonly SyncOperationResource[],
): ReadonlySet<string> {
  const identities = resources.map(({ group, kind, name }) =>
    resourceIdentity(group, kind, name),
  );
  const unique = new Set(identities);
  if (unique.size !== identities.length) {
    throw new Error(
      "Sync operation contains duplicate group/kind/name identities",
    );
  }
  return unique;
}

function activeOperationResourceIdentities(
  app: Record<string, unknown>,
): ReadonlySet<string> | null {
  const operation = app["operation"];
  if (!isRecord(operation)) {
    throw new Error("Cannot inspect resources for a missing live operation");
  }
  const sync = operation["sync"];
  if (!isRecord(sync)) {
    throw new Error("Active Argo operation is missing its sync request");
  }
  const resources = sync["resources"];
  if (resources === undefined) {
    return null;
  }
  const parsedResources = z
    .array(ActiveOperationResourceSchema)
    .parse(resources);
  if (parsedResources.length === 0) {
    return null;
  }
  return operationResourceIdentities(
    parsedResources.map(({ group, kind, name }) => ({
      group: group ?? "",
      kind,
      name,
    })),
  );
}

function operationReleasePhase(
  operation: Record<string, unknown>,
): ReleasePhase | undefined {
  const matches = (OperationInfoEntriesSchema.parse(operation).info ?? [])
    .filter(({ name }) => name === RELEASE_PHASE_INFO_NAME)
    .map(({ value }) => value);
  if (matches.length > 1) {
    throw new Error("Argo operation has multiple root release phases");
  }
  const phase = matches[0];
  return phase === undefined ? undefined : ReleasePhaseSchema.parse(phase);
}

function activeOperationPrunes(app: Record<string, unknown>): boolean {
  const operation = app["operation"];
  if (!isRecord(operation)) {
    throw new Error("Cannot inspect pruning for a missing live operation");
  }
  const sync = operation["sync"];
  if (!isRecord(sync)) {
    throw new Error("Active Argo operation is missing its sync request");
  }
  return sync["prune"] === true;
}

function requestedOperationReleasePhase(
  application: unknown,
): ReleasePhase | undefined {
  const parsed = z.record(z.string(), z.unknown()).parse(application);
  const operation = parsed["operation"];
  if (!isRecord(operation)) {
    throw new Error("Argo sync response is missing the requested operation");
  }
  return operationReleasePhase(operation);
}

function resourceIdentitySetsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every((identity) => right.has(identity))
  );
}

async function getRenderedResourceIdentities(
  appName: string,
  revision: string,
  token: string,
): Promise<ReadonlySet<string>> {
  return renderedResourceIdentities(
    await getApplicationManifests(appName, revision, token),
  );
}

type ExpectedSyncResultIdentities = {
  readonly desired: ReadonlySet<string>;
  readonly pruned: ReadonlySet<string>;
};

async function getExpectedSyncResultIdentities(
  appName: string,
  revision: string,
  token: string,
): Promise<ExpectedSyncResultIdentities> {
  return {
    desired: await getRenderedResourceIdentities(appName, revision, token),
    pruned: new Set(),
  };
}

type PreparedManifestOverride = {
  readonly override: ManifestOverride;
  readonly suspendedApplication: string | null;
};

type PreparedFinalRootManifest = {
  readonly deferredDesiredIdentity: string | null;
  readonly override: ManifestOverride;
};

type RootSyncBatch = {
  readonly manifests?: readonly string[];
  readonly resources: readonly SyncOperationResource[];
};

type ParsedRootManifest = {
  readonly parsed: unknown;
  readonly override: ManifestOverride;
};

function parseRootManifest(manifestSource: string): ParsedRootManifest {
  const parsed: unknown = JSON.parse(manifestSource);
  const renderedResource = RenderedResourceSchema.parse(parsed);
  const separator = renderedResource.apiVersion.indexOf("/");
  return {
    parsed,
    override: {
      manifest: manifestSource,
      resource: {
        group:
          separator === -1
            ? ""
            : renderedResource.apiVersion.slice(0, separator),
        kind: renderedResource.kind,
        name: renderedResource.metadata.name,
        ...(renderedResource.metadata.namespace === undefined
          ? {}
          : { namespace: renderedResource.metadata.namespace }),
      },
    },
  };
}

function prepareRootManifestOverride(
  manifestSource: string,
  suspendAllApplications: boolean,
): PreparedManifestOverride {
  const { parsed, override } = parseRootManifest(manifestSource);
  if (override.resource.kind !== "Application") {
    return {
      override,
      suspendedApplication: null,
    };
  }
  const application = RenderedApplicationSchema.parse(parsed);
  if (
    application.spec.syncPolicy === undefined ||
    !Object.hasOwn(application.spec.syncPolicy, "automated")
  ) {
    return {
      override,
      suspendedApplication: null,
    };
  }
  const isRepositoryApplication =
    application.spec.source.chart !== undefined &&
    REPOSITORY_CHART_URLS.has(application.spec.source.repoURL);
  if (!suspendAllApplications && !isRepositoryApplication) {
    return {
      override,
      suspendedApplication: null,
    };
  }
  const automated = application.spec.syncPolicy["automated"];
  if (!isRecord(automated)) {
    return {
      override,
      suspendedApplication: null,
    };
  }
  return {
    override: {
      manifest: JSON.stringify({
        ...application,
        spec: {
          ...application.spec,
          syncPolicy: {
            ...application.spec.syncPolicy,
            automated: { ...automated, enabled: false },
          },
        },
      }),
      resource: override.resource,
    },
    suspendedApplication: application.metadata.name,
  };
}

function prepareFinalRootManifestOverride(
  manifestSource: string,
  rootAppName: string,
): PreparedFinalRootManifest {
  const parsed = parseRootManifest(manifestSource);
  if (
    parsed.override.resource.group !== "argoproj.io" ||
    parsed.override.resource.kind !== "Application" ||
    parsed.override.resource.name !== rootAppName
  ) {
    return {
      deferredDesiredIdentity: null,
      override: parsed.override,
    };
  }
  const prepared = prepareRootManifestOverride(manifestSource, true);
  return {
    deferredDesiredIdentity:
      prepared.suspendedApplication === null
        ? null
        : resourceIdentity(
            prepared.override.resource.group,
            prepared.override.resource.kind,
            prepared.override.resource.name,
          ),
    override: prepared.override,
  };
}

/**
 * Argo's local-manifest sync path is required only when CI rewrites an
 * Application's auto-sync policy. Sending byte-identical manifests through
 * that path can report cluster-scoped resources as skipped without applying
 * them. Keep the original wave and request-size batching, then use exact-source
 * selective syncs for every resource whose rendered manifest is unchanged.
 */
function splitRootSyncBatches(
  batches: readonly ManifestOverrideBatch[],
  manifestOverrideIdentities: ReadonlySet<string>,
): RootSyncBatch[] {
  return batches.flatMap((batch) => {
    if (batch.manifests.length !== batch.resources.length) {
      throw new Error("Manifest override batch lost resource alignment");
    }
    const sourceResources: SyncOperationResource[] = [];
    const overrideManifests: string[] = [];
    const overrideResources: SyncOperationResource[] = [];
    for (const [index, resource] of batch.resources.entries()) {
      const manifest = batch.manifests[index];
      if (manifest === undefined) {
        throw new Error("Manifest override batch is missing a manifest");
      }
      const identity = resourceIdentity(
        resource.group,
        resource.kind,
        resource.name,
      );
      if (manifestOverrideIdentities.has(identity)) {
        overrideManifests.push(manifest);
        overrideResources.push(resource);
      } else {
        sourceResources.push(resource);
      }
    }
    return [
      ...(sourceResources.length === 0 ? [] : [{ resources: sourceResources }]),
      ...(overrideResources.length === 0
        ? []
        : [
            {
              manifests: overrideManifests,
              resources: overrideResources,
            },
          ]),
    ];
  });
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
    const prepared = prepareRootManifestOverride(manifestSource, false);
    if (prepared.suspendedApplication === null) {
      return [];
    }
    console.log(`suspending auto-sync: ${prepared.suspendedApplication}`);
    return [prepared.override];
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

const ROOT_BATCH_LABELS = {
  batch: "exact root batch",
  stage: "staged root batch",
} as const;

async function syncRootReleaseBatch(
  rootAppName: string,
  batch: RootSyncBatch,
  phase: "stage" | "batch",
  requestId: string,
  revision: string,
  timeoutSeconds: number,
): Promise<void> {
  await sync(rootAppName, timeoutSeconds, false, {
    prune: false,
    requestId,
    resources: batch.resources,
    revision,
    releasePhase: phase,
    terminateAfterApplied: true,
    ...(batch.manifests === undefined ? {} : { manifests: batch.manifests }),
  });
}

/**
 * Every batch of a release phase carries the same request UUID, revision, and
 * phase marker, so an interrupted process can identify its own in-flight batch
 * on retry. The live operation's exact resource selection decides which batch
 * it is; anything that does not match one of this phase's batches belongs to
 * different work and must not be adopted.
 */
async function syncRootReleaseBatches(
  rootAppName: string,
  batches: readonly RootSyncBatch[],
  phase: "stage" | "batch",
  requestId: string,
  revision: string,
  timeoutSeconds: number,
  token: string,
): Promise<void> {
  const label = ROOT_BATCH_LABELS[phase];
  let nextBatchIndex = 0;
  const application = await getApplication(rootAppName, token);
  const observation = observeOperation(application);
  assertMatchingRevision(observation, requestId, revision, rootAppName);
  assertMatchingLiveRevision(observation, requestId, revision, rootAppName);
  if (observation.hasLiveOperation) {
    if (!liveOperationMatches(observation, requestId, revision)) {
      throw new Error(
        `Refusing to replace active ${rootAppName} operation ${liveOperationDescription(observation)}; expected request ${requestId}`,
      );
    }
    const activeResources = activeOperationResourceIdentities(application);
    if (
      activeResources === null ||
      observation.liveReleasePhase !== phase ||
      activeOperationPrunes(application)
    ) {
      throw new Error(
        `Active ${rootAppName} selective operation is not a marked ${label}`,
      );
    }
    const activeBatchIndex = batches.findIndex((batch) =>
      resourceIdentitySetsEqual(
        activeResources,
        operationResourceIdentities(batch.resources),
      ),
    );
    if (activeBatchIndex === -1) {
      throw new Error(
        `Active ${rootAppName} operation for request ${requestId} does not match an ${label}`,
      );
    }
    const activeBatch = batches[activeBatchIndex];
    if (activeBatch === undefined) {
      throw new Error("Matched root batch is missing");
    }
    console.log(
      `adopting ${label} ${(activeBatchIndex + 1).toString()}/${batches.length.toString()} (${activeBatch.resources.length.toString()} resources)`,
    );
    await syncRootReleaseBatch(
      rootAppName,
      activeBatch,
      phase,
      requestId,
      revision,
      timeoutSeconds,
    );
    nextBatchIndex = activeBatchIndex + 1;
  }
  for (let index = nextBatchIndex; index < batches.length; index += 1) {
    const batch = batches[index];
    if (batch === undefined) {
      throw new Error(`${label} ${index.toString()} is missing`);
    }
    console.log(
      `syncing ${label} ${(index + 1).toString()}/${batches.length.toString()} (${batch.resources.length.toString()} resources)`,
    );
    await syncRootReleaseBatch(
      rootAppName,
      batch,
      phase,
      requestId,
      revision,
      timeoutSeconds,
    );
  }
}

async function stageRootRelease(
  rootAppName: string,
  revision: string,
  requestId: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  const exactRevision = BuildRevisionSchema.parse(revision);
  const exactRequestId = SyncRequestIdSchema.parse(requestId);
  console.log(
    `--- argocd stage-root-release: ${rootAppName} at ${exactRevision} for request ${exactRequestId}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    return;
  }
  await assertExpectedAppsRevisionIsLatest(exactRevision, timeoutSeconds);
  const token = requireEnv("ARGOCD_TOKEN");
  const manifests = await getApplicationManifests(
    rootAppName,
    exactRevision,
    token,
  );
  if (manifests.length === 0) {
    throw new Error("Rendered root release contains no resources");
  }
  const staged = manifests.map((manifestSource) =>
    prepareRootManifestOverride(manifestSource, true),
  );
  for (const prepared of staged) {
    if (prepared.suspendedApplication !== null) {
      console.log(`suspending auto-sync: ${prepared.suspendedApplication}`);
    }
  }
  const manifestOverrideIdentities = new Set(
    staged.flatMap(({ override, suspendedApplication }) =>
      suspendedApplication === null
        ? []
        : [
            resourceIdentity(
              override.resource.group,
              override.resource.kind,
              override.resource.name,
            ),
          ],
    ),
  );
  const batches = splitRootSyncBatches(
    batchManifestOverrides(
      staged.map(({ override }) => override),
      { revision: exactRevision, releasePhase: "stage" },
    ),
    manifestOverrideIdentities,
  );
  await syncRootReleaseBatches(
    rootAppName,
    batches,
    "stage",
    exactRequestId,
    exactRevision,
    timeoutSeconds,
    token,
  );
}

async function finalizeRootRelease(
  rootAppName: string,
  revision: string,
  requestId: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  const exactRevision = BuildRevisionSchema.parse(revision);
  const exactRequestId = SyncRequestIdSchema.parse(requestId);
  if (rootAppName !== "apps") {
    throw new Error("finalize-root-release only supports the apps root");
  }
  console.log(
    `--- argocd finalize-root-release: ${rootAppName} at ${exactRevision} for request ${exactRequestId}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    return;
  }
  await assertExpectedAppsRevisionIsLatest(exactRevision, timeoutSeconds);
  const token = requireEnv("ARGOCD_TOKEN");
  const manifests = await getApplicationManifests(
    rootAppName,
    exactRevision,
    token,
  );
  if (manifests.length === 0) {
    throw new Error("Rendered root release contains no resources");
  }
  const preparedManifests = manifests.map((manifestSource) =>
    prepareFinalRootManifestOverride(manifestSource, rootAppName),
  );
  const allDesiredIdentities = operationResourceIdentities(
    preparedManifests.map(({ override }) => override.resource),
  );
  const deferredDesiredIdentities = new Set(
    preparedManifests.flatMap(({ deferredDesiredIdentity }) =>
      deferredDesiredIdentity === null ? [] : [deferredDesiredIdentity],
    ),
  );
  const verifiedRootDesiredIdentities = new Set(
    [...allDesiredIdentities].filter(
      (identity) => !deferredDesiredIdentities.has(identity),
    ),
  );
  const batches = splitRootSyncBatches(
    batchManifestOverrides(
      preparedManifests.map(({ override }) => override),
      { revision: exactRevision, releasePhase: "batch" },
    ),
    deferredDesiredIdentities,
  );

  const initialApplication = await getApplication(rootAppName, token);
  const initialOperation = observeOperation(initialApplication);
  assertMatchingRevision(
    initialOperation,
    exactRequestId,
    exactRevision,
    rootAppName,
  );
  assertMatchingLiveRevision(
    initialOperation,
    exactRequestId,
    exactRevision,
    rootAppName,
  );
  if (
    initialOperation.hasLiveOperation &&
    activeOperationResourceIdentities(initialApplication) === null
  ) {
    if (
      !liveOperationMatches(initialOperation, exactRequestId, exactRevision)
    ) {
      throw new Error(
        `Refusing to replace active ${rootAppName} operation ${liveOperationDescription(initialOperation)}; expected request ${exactRequestId}`,
      );
    }
    if (
      initialOperation.liveReleasePhase !== "prune" ||
      !activeOperationPrunes(initialApplication)
    ) {
      throw new Error(
        `Active ${rootAppName} full-source operation is not the marked final root prune`,
      );
    }
    console.log(`adopting active final root prune: ${rootAppName}`);
    await sync(rootAppName, timeoutSeconds, false, {
      prune: true,
      requestId: exactRequestId,
      revision: exactRevision,
      releasePhase: "prune",
      terminateAfterApplied: true,
      verifiedRootDesiredIdentities,
    });
    return;
  }

  await syncRootReleaseBatches(
    rootAppName,
    batches,
    "batch",
    exactRequestId,
    exactRevision,
    timeoutSeconds,
    token,
  );

  await sync(rootAppName, timeoutSeconds, false, {
    prune: true,
    requestId: exactRequestId,
    revision: exactRevision,
    releasePhase: "prune",
    terminateAfterApplied: true,
    verifiedRootDesiredIdentities,
  });
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
): Promise<ExpectedSyncResultIdentities> {
  const exactRevision = BuildRevisionSchema.parse(revision);
  const manifests = await getApplicationManifests("apps", exactRevision, token);
  const desiredResources = renderedResourceIdentities(manifests);
  const desiredChildren = new Set(
    manifests.flatMap((manifestSource) => {
      const parsed = RenderedObjectSchema.parse(JSON.parse(manifestSource));
      if (parsed.kind !== "Application") {
        return [];
      }
      return [RenderedApplicationSchema.parse(parsed).metadata.name];
    }),
  );
  const root = await getApplication("apps", token);
  const status = isRecord(root["status"]) ? root["status"] : {};
  const resources = Array.isArray(status["resources"])
    ? status["resources"]
    : [];
  const candidates = new Map<string, string>();
  for (const resource of resources) {
    if (
      !isRecord(resource) ||
      resource["kind"] !== "Application" ||
      (resource["group"] !== undefined &&
        resource["group"] !== "argoproj.io") ||
      typeof resource["name"] !== "string" ||
      resource["name"] === "apps" ||
      desiredChildren.has(resource["name"])
    ) {
      continue;
    }
    candidates.set(
      resource["name"],
      resourceIdentity("argoproj.io", "Application", resource["name"]),
    );
  }
  for (const childName of candidates.keys()) {
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
  return {
    desired: desiredResources,
    pruned: new Set(candidates.values()),
  };
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
  releasePhase?: ReleasePhase;
  terminateAfterApplied?: boolean;
  verifiedRootDesiredIdentities?: ReadonlySet<string>;
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
  const verifiedRootDesiredIdentities = options.verifiedRootDesiredIdentities;
  if (
    options.releasePhase !== undefined &&
    (options.requestId === undefined || options.revision === undefined)
  ) {
    throw new Error("Release phases require an exact request and revision");
  }
  if (
    options.releasePhase !== undefined &&
    options.releasePhase !== "child" &&
    (appName !== "apps" ||
      options.terminateAfterApplied !== true ||
      (options.releasePhase === "prune") !== options.prune)
  ) {
    throw new Error(
      "Root release phases require an identity-bound atomic apps batch or prune",
    );
  }
  // A child reconciliation always applies the child's complete rendered source.
  // Declaring that here is what lets adoption reject a selective operation that
  // merely shares the release identity.
  if (
    options.releasePhase === "child" &&
    (appName === "apps" ||
      options.manifests !== undefined ||
      options.resources !== undefined)
  ) {
    throw new Error(
      "Child release phases require a full-source sync of a managed Application",
    );
  }
  if (
    verifiedRootDesiredIdentities !== undefined &&
    (appName !== "apps" ||
      !options.prune ||
      options.releasePhase !== "prune" ||
      options.terminateAfterApplied !== true)
  ) {
    throw new Error(
      "Verified root desired state can only narrow an applied-result boundary for atomic apps pruning",
    );
  }
  let expectedResourceIdentities: ExpectedSyncResultIdentities | undefined;
  if (appName === "apps" && options.prune) {
    if (options.revision === undefined) {
      throw new Error(
        "Root Application pruning requires an exact --revision so prune candidates can be verified against the rendered source",
      );
    }
    const rootExpectedResourceIdentities = await assertRootPruneSafe(
      token,
      options.revision,
    );
    if (verifiedRootDesiredIdentities === undefined) {
      expectedResourceIdentities = rootExpectedResourceIdentities;
    } else {
      for (const identity of verifiedRootDesiredIdentities) {
        if (!rootExpectedResourceIdentities.desired.has(identity)) {
          throw new Error(
            `Verified root desired identity ${identity} is absent from the exact rendered revision`,
          );
        }
      }
      expectedResourceIdentities = {
        desired: new Set(
          [...rootExpectedResourceIdentities.desired].filter(
            (identity) => !verifiedRootDesiredIdentities.has(identity),
          ),
        ),
        pruned: rootExpectedResourceIdentities.pruned,
      };
    }
  }
  if (
    options.terminateAfterApplied === true &&
    options.revision === undefined
  ) {
    throw new Error("--terminate-after-applied requires an exact --revision");
  }
  if (
    options.terminateAfterApplied === true &&
    options.revision !== undefined &&
    expectedResourceIdentities === undefined
  ) {
    if (options.resources === undefined) {
      expectedResourceIdentities = await getExpectedSyncResultIdentities(
        appName,
        options.revision,
        token,
      );
    } else {
      const identities = options.resources.map(({ group, kind, name }) =>
        resourceIdentity(group, kind, name),
      );
      if (identities.length === 0) {
        throw new Error(
          "Manifest-override termination requires at least one selected resource",
        );
      }
      const unique = new Set(identities);
      if (unique.size !== identities.length) {
        throw new Error(
          "Manifest-override termination received duplicate group/kind/name identities",
        );
      }
      expectedResourceIdentities = {
        desired: unique,
        pruned: new Set(),
      };
    }
  }
  const requestId = SyncRequestIdSchema.parse(
    options.requestId ?? crypto.randomUUID(),
  );
  let operationId: string = crypto.randomUUID();
  const retryable =
    options.requestId !== undefined || options.terminateAfterApplied === true;
  let baseline: OperationObservation | undefined;
  let adopted = false;

  if (retryable) {
    const baselineApplication = await getApplication(appName, token);
    baseline = observeOperation(baselineApplication);
    assertMatchingRevision(baseline, requestId, options.revision, appName);
    assertMatchingLiveRevision(baseline, requestId, options.revision, appName);
    if (baseline.hasLiveOperation) {
      if (
        !liveOperationMatches(
          baseline,
          requestId,
          options.revision,
          undefined,
          options.releasePhase,
        )
      ) {
        throw new Error(
          `Refusing to replace active ${appName} operation ${liveOperationDescription(baseline)}; expected request ${requestId}`,
        );
      }
      if (
        options.releasePhase === "child" &&
        activeOperationResourceIdentities(baselineApplication) !== null
      ) {
        throw new Error(
          `Refusing to adopt a selective ${appName} operation for request ${requestId}; expected the full-source child reconciliation`,
        );
      }
      operationId = requireLiveOperationId(baseline, appName);
      const completedOperationMatches = operationMatches(
        baseline,
        requestId,
        options.revision,
        operationId,
        options.releasePhase,
      );
      if (completedOperationMatches && baseline.phase === "Terminating") {
        if (
          options.terminateAfterApplied === true &&
          options.revision !== undefined &&
          syncResultApplied(
            baseline.state,
            options.revision,
            expectedResourceIdentities,
          )
        ) {
          await waitForOperationToClear(
            appName,
            token,
            requestId,
            options.revision,
            operationId,
            baseline.startedAt,
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
        infos: [
          { name: SYNC_REQUEST_ID_INFO_NAME, value: requestId },
          { name: SYNC_OPERATION_ID_INFO_NAME, value: operationId },
          ...(options.revision === undefined
            ? []
            : [{ name: SYNC_REVISION_INFO_NAME, value: options.revision }]),
          ...(options.releasePhase === undefined
            ? []
            : [
                {
                  name: RELEASE_PHASE_INFO_NAME,
                  value: options.releasePhase,
                },
              ]),
        ],
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
    const responseBody: unknown = await res.json();
    const responseRequestId = requestedOperationRequestId(responseBody);
    if (responseRequestId !== requestId) {
      throw new Error(
        `Argo sync response returned request ${responseRequestId}; expected ${requestId}`,
      );
    }
    const responseOperationId = requestedOperationId(responseBody);
    if (responseOperationId !== operationId) {
      throw new Error(
        `Argo sync response returned operation ${responseOperationId}; expected ${operationId}`,
      );
    }
    if (
      options.revision !== undefined &&
      requestedOperationRevision(responseBody) !== options.revision
    ) {
      throw new Error(
        `Argo sync response returned a different CI revision; expected ${options.revision}`,
      );
    }
    if (requestedOperationReleasePhase(responseBody) !== options.releasePhase) {
      throw new Error(
        `Argo sync response returned a different root release phase; expected ${options.releasePhase ?? "none"}`,
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
    operationId,
    releasePhase: options.releasePhase,
    expectedResourceIdentities,
    revision: options.revision,
    timeoutSeconds,
    terminateAfterApplied: options.terminateAfterApplied === true,
  });
}

function operationState(app: Record<string, unknown>): Record<string, unknown> {
  const status = isRecord(app["status"]) ? app["status"] : {};
  return isRecord(status["operationState"]) ? status["operationState"] : {};
}

type OperationObservation = {
  readonly hasLiveOperation: boolean;
  readonly liveOperationId: string | null;
  readonly liveRequestId: string | null;
  readonly liveRevision: string | undefined;
  readonly liveReleasePhase: ReleasePhase | undefined;
  readonly operationId: string | null;
  readonly phase: string;
  readonly requestId: string | null;
  readonly revision: string | undefined;
  readonly releasePhase: ReleasePhase | undefined;
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
  return {
    hasLiveOperation: liveOperation !== undefined,
    liveOperationId:
      liveOperation === undefined ? null : activeOperationId(app),
    liveRequestId:
      liveOperation === undefined ? null : activeOperationRequestId(app),
    liveRevision:
      liveOperation === undefined
        ? undefined
        : operationRevision(liveOperation),
    liveReleasePhase:
      liveOperation === undefined
        ? undefined
        : operationReleasePhase(liveOperation),
    phase: typeof phase === "string" ? phase : "",
    operationId: completedOperationId(app),
    requestId: completedOperationRequestId(app),
    revision:
      completedOperation === undefined
        ? undefined
        : operationRevision(completedOperation),
    releasePhase:
      completedOperation === undefined
        ? undefined
        : operationReleasePhase(completedOperation),
    startedAt: OperationStartedAtSchema.parse(state["startedAt"]),
    state,
  };
}

function liveOperationMatches(
  operation: OperationObservation,
  requestId: string,
  revision: string | undefined,
  operationId?: string | null,
  releasePhase?: ReleasePhase,
): boolean {
  return (
    operation.hasLiveOperation &&
    operation.liveRequestId === requestId &&
    (revision === undefined || operation.liveRevision === revision) &&
    (operationId === undefined || operation.liveOperationId === operationId) &&
    (releasePhase === undefined || operation.liveReleasePhase === releasePhase)
  );
}

function operationMatches(
  operation: OperationObservation,
  requestId: string,
  revision: string | undefined,
  operationId?: string | null,
  releasePhase?: ReleasePhase,
): boolean {
  return (
    operation.requestId === requestId &&
    (revision === undefined || operation.revision === revision) &&
    (operationId === undefined || operation.operationId === operationId) &&
    (releasePhase === undefined || operation.releasePhase === releasePhase)
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
  return `${operation.requestId ?? "without a request ID"} at ${operation.revision ?? "unknown revision"} (${operation.operationId ?? "without an operation ID"})`;
}

function liveOperationDescription(operation: OperationObservation): string {
  return `${operation.liveRequestId ?? "without a request ID"} at ${operation.liveRevision ?? "unknown revision"} (${operation.liveOperationId ?? "without an operation ID"})`;
}

function requireLiveOperationId(
  operation: OperationObservation,
  appName: string,
): string {
  if (operation.liveOperationId === null) {
    throw new Error(
      `Refusing active ${appName} operation without a CI operation ID`,
    );
  }
  return SyncOperationIdSchema.parse(operation.liveOperationId);
}

function recoveryLiveOperationId(
  operation: OperationObservation,
): string | null | undefined {
  if (!operation.hasLiveOperation) {
    return undefined;
  }
  return operation.liveOperationId === null
    ? null
    : SyncOperationIdSchema.parse(operation.liveOperationId);
}

function operationStartedAfter(
  operation: OperationObservation,
  startedAt: string | undefined,
): boolean {
  return (
    operation.startedAt !== undefined &&
    startedAt !== undefined &&
    Date.parse(operation.startedAt) > Date.parse(startedAt)
  );
}

function operationPollIntervalMs(): number {
  const configured = optionalEnv("ARGOCD_POLL_INTERVAL_MS");
  return configured === null
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
  expectedResourceIdentities: ExpectedSyncResultIdentities | undefined,
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
  const appliedResourceIdentities = new Set<string>();
  const prunedResourceIdentities = new Set<string>();
  const everyReportedResourceApplied = resources.every((resource: unknown) => {
    if (!isRecord(resource)) {
      return false;
    }
    const status = resource["status"];
    const hookType = resource["hookType"];
    const hookPhase = resource["hookPhase"];
    const group = resource["group"];
    const kind = resource["kind"];
    const name = resource["name"];
    if (
      (group !== undefined && typeof group !== "string") ||
      typeof kind !== "string" ||
      typeof name !== "string"
    ) {
      return false;
    }
    if (
      hookType !== undefined &&
      hookType !== null &&
      typeof hookType !== "string"
    ) {
      return false;
    }
    const identity = resourceIdentity(group ?? "", kind, name);
    appliedResourceIdentities.add(identity);
    if (status === "Pruned") {
      prunedResourceIdentities.add(identity);
    }
    return (
      (status === "Synced" || status === "Pruned" || status === "Skipped") &&
      !(
        hookType !== undefined &&
        hookType !== null &&
        (hookPhase === "Failed" || hookPhase === "Error")
      )
    );
  });
  return (
    everyReportedResourceApplied &&
    (expectedResourceIdentities === undefined ||
      ([...expectedResourceIdentities.desired].every((identity) =>
        appliedResourceIdentities.has(identity),
      ) &&
        [...expectedResourceIdentities.pruned].every((identity) =>
          prunedResourceIdentities.has(identity),
        )))
  );
}

type WaitForIdentifiedOperationOptions = {
  readonly appName: string;
  readonly expectedResourceIdentities: ExpectedSyncResultIdentities | undefined;
  readonly operationId: string;
  readonly requestId: string;
  readonly revision: string | undefined;
  readonly releasePhase: ReleasePhase | undefined;
  readonly terminateAfterApplied: boolean;
  readonly timeoutSeconds: number;
  readonly token: string;
};

async function waitForIdentifiedOperation({
  appName,
  expectedResourceIdentities,
  operationId,
  requestId,
  revision,
  releasePhase,
  terminateAfterApplied,
  timeoutSeconds,
  token,
}: WaitForIdentifiedOperationOptions): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let exactOperationSeen = false;
  while (Date.now() < deadline) {
    const current = observeOperation(await getApplication(appName, token));
    assertMatchingRevision(current, requestId, revision, appName);
    assertMatchingLiveRevision(current, requestId, revision, appName);
    const isExpected = operationMatches(
      current,
      requestId,
      revision,
      operationId,
      releasePhase,
    );
    const isExpectedLiveOperation = liveOperationMatches(
      current,
      requestId,
      revision,
      operationId,
      releasePhase,
    );
    if (current.hasLiveOperation && !isExpectedLiveOperation) {
      throw new Error(
        `Active ${appName} operation changed to ${liveOperationDescription(current)} while waiting for request ${requestId}`,
      );
    }
    if (!exactOperationSeen && isExpected) {
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
        if (current.hasLiveOperation) {
          await waitForOperationToClear(
            appName,
            token,
            requestId,
            revision,
            operationId,
            current.startedAt,
            timeoutSeconds,
          );
        }
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
        syncResultApplied(current.state, revision, expectedResourceIdentities)
      ) {
        await terminateAppliedOperation(
          appName,
          token,
          requestId,
          revision,
          operationId,
          current.startedAt,
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

async function waitForOperationToClear(
  appName: string,
  token: string,
  requestId: string,
  revision: string | undefined,
  operationId: string | null,
  startedAt: string | undefined,
  timeoutSeconds: number,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const current = observeOperation(await getApplication(appName, token));
    assertMatchingRevision(current, requestId, revision, appName);
    assertMatchingLiveRevision(current, requestId, revision, appName);
    const isExpectedLiveOperation = liveOperationMatches(
      current,
      requestId,
      revision,
      operationId,
    );
    if (current.hasLiveOperation && !isExpectedLiveOperation) {
      throw new Error(
        `${appName} operation changed to ${liveOperationDescription(current)} while waiting for request ${requestId} to clear`,
      );
    }
    if (!current.hasLiveOperation) {
      if (operationStartedAfter(current, startedAt)) {
        throw new Error(
          `${appName} operation changed to ${operationDescription(current)} while waiting for request ${requestId} to clear`,
        );
      }
      return;
    }
    await sleepUntilNextOperationPoll(deadline);
  }
  throw new Error(
    `Timeout: ${appName} operation for request ${requestId} did not clear within ${timeoutSeconds.toString()}s`,
  );
}

async function terminateAppliedOperation(
  appName: string,
  token: string,
  requestId: string,
  revision: string,
  operationId: string | null,
  startedAt: string | undefined,
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
  await waitForOperationToClear(
    appName,
    token,
    requestId,
    revision,
    operationId,
    startedAt,
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
  const expectedResourceIdentities =
    appName === "apps"
      ? await assertRootPruneSafe(token, exactRevision)
      : await getExpectedSyncResultIdentities(appName, exactRevision, token);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const current = observeOperation(await getApplication(appName, token));
    assertMatchingRevision(current, exactRequestId, exactRevision, appName);
    assertMatchingLiveRevision(current, exactRequestId, exactRevision, appName);
    const isExpectedLogicalOperation = operationMatches(
      current,
      exactRequestId,
      exactRevision,
    );
    const isExpectedLogicalLiveOperation = liveOperationMatches(
      current,
      exactRequestId,
      exactRevision,
    );
    if (current.hasLiveOperation && !isExpectedLogicalLiveOperation) {
      throw new Error(
        `Refusing to terminate active ${appName} operation ${liveOperationDescription(current)}; expected request ${exactRequestId} at ${exactRevision}`,
      );
    }
    if (
      isExpectedLogicalOperation &&
      !current.hasLiveOperation &&
      (current.phase === "Failed" || current.phase === "Error")
    ) {
      const message = current.state["message"];
      throw new Error(
        `Async sync operation ${current.phase} for ${appName} at ${exactRevision}: ${typeof message === "string" ? message.slice(0, 1024) : ""}`,
      );
    }
    if (
      isExpectedLogicalOperation &&
      !current.hasLiveOperation &&
      current.phase === "Succeeded"
    ) {
      console.log(`async sync operation already finalized: ${appName}`);
      return;
    }
    const liveOperationId = recoveryLiveOperationId(current);
    const isExpectedOperation =
      liveOperationId !== undefined &&
      operationMatches(current, exactRequestId, exactRevision, liveOperationId);
    console.log(
      `Operation: ${current.phase || "(pending)"}${isExpectedOperation ? "" : " [previous op]"}; ` +
        `applied=${isExpectedOperation && syncResultApplied(current.state, exactRevision, expectedResourceIdentities) ? "true" : "false"} ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (
      liveOperationId !== undefined &&
      isExpectedOperation &&
      current.phase === "Terminating"
    ) {
      if (
        !syncResultApplied(
          current.state,
          exactRevision,
          expectedResourceIdentities,
        )
      ) {
        throw new Error(
          `Matching ${appName} operation entered Terminating before its result was fully applied`,
        );
      }
      await waitForOperationToClear(
        appName,
        token,
        exactRequestId,
        exactRevision,
        liveOperationId,
        current.startedAt,
        timeoutSeconds,
      );
      return;
    }
    if (
      liveOperationId !== undefined &&
      isExpectedOperation &&
      current.phase === "Running" &&
      syncResultApplied(
        current.state,
        exactRevision,
        expectedResourceIdentities,
      )
    ) {
      await terminateAppliedOperation(
        appName,
        token,
        exactRequestId,
        exactRevision,
        liveOperationId,
        current.startedAt,
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

function applicationSyncWave(
  application: z.infer<typeof RenderedApplicationSchema>,
): number {
  const raw =
    application.metadata.annotations?.["argocd.argoproj.io/sync-wave"] ?? "0";
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(
      `Application ${application.metadata.name} has invalid sync wave ${raw}`,
    );
  }
  const wave = Number(raw);
  if (!Number.isSafeInteger(wave)) {
    throw new Error(
      `Application ${application.metadata.name} has unsafe sync wave ${raw}`,
    );
  }
  return wave;
}

function applicationPrunes(
  application: z.infer<typeof RenderedApplicationSchema>,
): boolean {
  const automated = application.spec.syncPolicy?.["automated"];
  return isRecord(automated) && automated["prune"] === true;
}

function releaseReconciliationTargets(
  manifests: readonly string[],
  expected: readonly ExpectedApplication[],
  rootAppName: string,
): readonly ReleaseReconciliationTarget[] {
  const expectedByName = new Map<string, ExpectedApplication>();
  for (const application of expected) {
    if (expectedByName.has(application.name)) {
      throw new Error(
        `Expected release inventory contains duplicate Application ${application.name}`,
      );
    }
    expectedByName.set(application.name, application);
  }
  if (!expectedByName.delete(rootAppName)) {
    throw new Error(
      `Expected release inventory is missing the ${rootAppName} revision`,
    );
  }

  const targets: ReleaseReconciliationTarget[] = [];
  for (const [order, manifestSource] of manifests.entries()) {
    const parsed: unknown = JSON.parse(manifestSource);
    if (RenderedObjectSchema.parse(parsed).kind !== "Application") {
      continue;
    }
    const application = RenderedApplicationSchema.parse(parsed);
    if (application.metadata.name === rootAppName) {
      continue;
    }
    const published = expectedByName.get(application.metadata.name);
    if (
      published === undefined &&
      application.spec.source.chart !== undefined &&
      REPOSITORY_CHART_URLS.has(application.spec.source.repoURL)
    ) {
      throw new Error(
        `Release inventory is missing repository Application ${application.metadata.name}`,
      );
    }
    if (published !== undefined) {
      expectedByName.delete(application.metadata.name);
    }
    targets.push({
      name: application.metadata.name,
      order,
      prune: published?.prune ?? applicationPrunes(application),
      repositoryRelease: published !== undefined,
      revision: published?.revision ?? application.spec.source.targetRevision,
      source: application.spec.source,
      wave: applicationSyncWave(application),
    });
  }

  if (expectedByName.size > 0) {
    throw new Error(
      `Release inventory contains Applications absent from the exact root revision: ${[...expectedByName.keys()].sort().join(", ")}`,
    );
  }
  return targets.sort(
    (left, right) => left.wave - right.wave || left.order - right.order,
  );
}

function latestDeployment(current: z.infer<typeof ReconcileApplicationSchema>):
  | {
      readonly revision: string;
      readonly source?: z.infer<typeof ApplicationSourceSchema> | undefined;
    }
  | undefined {
  const history = current.status?.history;
  if (history === undefined || history.length === 0) {
    return undefined;
  }
  return history.reduce((latest, candidate) =>
    candidate.id > latest.id ? candidate : latest,
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Application source contains a non-JSON value");
  }
  return serialized;
}

/**
 * The release inventory is operator input, so every command that consumes it
 * parses and binds it before mutating anything. `release-root` validates it
 * ahead of staging so invalid input cannot leave root prerequisites applied
 * and child auto-sync suspended.
 */
async function readExpectedApplications(
  expectedPath: string,
): Promise<readonly ExpectedApplication[]> {
  return ExpectedApplicationsSchema.parse(
    JSON.parse(await Bun.file(expectedPath).text()),
  );
}

function expectedAppsRelease(
  expected: readonly ExpectedApplication[],
): ExpectedApplication {
  const appsRelease = expected.find(
    (application) => application.name === "apps",
  );
  if (appsRelease === undefined) {
    throw new Error("Expected release inventory is missing the apps revision");
  }
  return appsRelease;
}

/**
 * `releaseReconciliationTargets` is the only complete oracle for the release
 * inventory: it rejects duplicate children, a missing repository child, and any
 * Application absent from the exact rendered root. Running it before staging
 * keeps semantically invalid input from applying root prerequisites and
 * suspending child auto-sync first.
 */
async function assertReleaseInventoryIsComplete(
  rootAppName: string,
  expected: readonly ExpectedApplication[],
  revision: string,
  token: string,
): Promise<void> {
  releaseReconciliationTargets(
    await getApplicationManifests(rootAppName, revision, token),
    expected,
    rootAppName,
  );
}

async function reconcileRelease(
  expectedPath: string,
  timeoutSeconds: number,
  dryRun: boolean,
  deferredApps: ReadonlySet<string>,
  waitForHealth: boolean,
  requestId: string | undefined,
): Promise<void> {
  const exactRequestId =
    requestId === undefined ? undefined : SyncRequestIdSchema.parse(requestId);
  const expected = await readExpectedApplications(expectedPath);
  if (dryRun) {
    console.log(
      `DRYRUN: would reconcile ${expected.length.toString()} expected Application(s)` +
        (deferredApps.size === 0
          ? ""
          : `; defer ${[...deferredApps].join(", ")}`),
    );
    return;
  }
  const appsRelease = expectedAppsRelease(expected);
  await assertExpectedAppsRevisionIsLatest(
    appsRelease.revision,
    timeoutSeconds,
  );
  const token = requireEnv("ARGOCD_TOKEN");
  const targets = releaseReconciliationTargets(
    await getApplicationManifests("apps", appsRelease.revision, token),
    expected,
    "apps",
  );
  // The release step handles the root Application with the subsequent atomic
  // sync. Waiting for it here would make every release depend on unrelated
  // child Application health.
  for (const wanted of targets) {
    if (deferredApps.has(wanted.name)) {
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
    const deployed = latestDeployment(current);
    const failedCurrentOperation =
      (operationPhase === "Failed" || operationPhase === "Error") &&
      (operationRevision === undefined || operationRevision === revision);
    const deployedExpectedRepositoryRelease =
      wanted.repositoryRelease &&
      syncStatus === "Synced" &&
      revision === wanted.revision &&
      deployed?.revision === wanted.revision &&
      !failedCurrentOperation;
    // An externally sourced child needs the same failed-operation retry as a
    // repository release. ArgoCD never re-runs a sync for an application it
    // already considers Synced, so a failure recorded against the current
    // revision stays on the Application forever, keeps the child reporting
    // Progressing, and blocks every later root health wave.
    const deployedExpectedExternalSource =
      !wanted.repositoryRelease &&
      deployed?.source !== undefined &&
      canonicalJson(deployed.source) === canonicalJson(wanted.source) &&
      !failedCurrentOperation;
    if (deployedExpectedRepositoryRelease || deployedExpectedExternalSource) {
      continue;
    }
    await assertApplySafe(wanted.name, token, wanted.revision);
    await sync(wanted.name, timeoutSeconds, false, {
      prune: wanted.prune,
      revision: wanted.revision,
      ...(exactRequestId === undefined
        ? {}
        : { requestId: exactRequestId, releasePhase: "child" }),
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
  const expected = await readExpectedApplications(expectedPath);
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

async function releaseRoot(
  rootAppName: string,
  expectedPath: string,
  revision: string,
  requestId: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  if (rootAppName !== "apps") {
    throw new Error("release-root only supports the apps root");
  }
  const exactRevision = BuildRevisionSchema.parse(revision);
  const exactRequestId = SyncRequestIdSchema.parse(requestId);
  const expected = await readExpectedApplications(expectedPath);
  const appsRelease = expectedAppsRelease(expected);
  if (appsRelease.revision !== exactRevision) {
    throw new Error(
      `Release inventory declares apps ${appsRelease.revision}; expected ${exactRevision}`,
    );
  }
  console.log(
    `--- argocd release-root: ${rootAppName} at ${exactRevision} for request ${exactRequestId}${dryRun ? " (dry run)" : ""}`,
  );
  if (!dryRun) {
    await assertReleaseInventoryIsComplete(
      rootAppName,
      expected,
      exactRevision,
      requireEnv("ARGOCD_TOKEN"),
    );
  }
  await stageRootRelease(
    rootAppName,
    exactRevision,
    exactRequestId,
    timeoutSeconds,
    dryRun,
  );
  await reconcileRelease(
    expectedPath,
    timeoutSeconds,
    dryRun,
    new Set(),
    false,
    exactRequestId,
  );
  await finalizeRootRelease(
    rootAppName,
    exactRevision,
    exactRequestId,
    timeoutSeconds,
    dryRun,
  );
  await releaseHealthWait(expectedPath, timeoutSeconds, dryRun);
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
      "  bun packages/homelab/scripts/argocd.ts sync-managed <app> " +
      "[--revision <v>] [--prune] [--terminate-after-applied] " +
      "[--request-id <uuid>] [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts release-root apps <expected.json> " +
      "--revision <v> --request-id <uuid> [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts delete-application <app> " +
      "--project <project> [--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts health-wait <app> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts tree-health-wait <app> " +
      "[--timeout <s>] [--dry-run]\n" +
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
    case "sync-managed": {
      const revision = flag(argv, "revision");
      const requestId = flag(argv, "request-id");
      const terminateAfterApplied = argv.includes("--terminate-after-applied");
      if (argv.includes("--async")) {
        console.error("sync-managed is bounded and does not support --async.");
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
      if (!dryRun) {
        await assertApplySafe(app, requireEnv("ARGOCD_TOKEN"), revision);
      }
      await sync(app, timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S, dryRun, {
        prune: argv.includes("--prune"),
        waitForCompletion: true,
        terminateAfterApplied,
        ...(revision === undefined ? {} : { revision }),
        ...(exactRequestId === undefined ? {} : { requestId: exactRequestId }),
      });
      return;
    }
    // Internal compatibility primitives keep the detailed lifecycle tests and
    // exact-operation recovery path executable. Buildkite and operator docs
    // expose only release-root and sync-managed.
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
    case "suspend-auto-sync":
      await suspendRepositoryAutoSync(
        app,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
        flag(argv, "revision"),
      );
      return;
    case "reconcile-release":
      await reconcileRelease(
        app,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
        new Set(),
        !argv.includes("--skip-health-wait"),
        flag(argv, "request-id"),
      );
      return;
    case "stage-root-release": {
      const revision = flag(argv, "revision");
      const requestId = flag(argv, "request-id");
      if (revision === undefined || requestId === undefined) {
        console.error(
          "--revision and --request-id are required for stage-root-release.",
        );
        usage();
      }
      await stageRootRelease(
        app,
        revision,
        requestId,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
      );
      return;
    }
    case "finalize-root-release": {
      const revision = flag(argv, "revision");
      const requestId = flag(argv, "request-id");
      if (revision === undefined || requestId === undefined) {
        console.error(
          "--revision and --request-id are required for finalize-root-release.",
        );
        usage();
      }
      await finalizeRootRelease(
        app,
        revision,
        requestId,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
      );
      return;
    }
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
    case "release-root": {
      const expectedPath = argv[2];
      const revision = flag(argv, "revision");
      const requestId = flag(argv, "request-id");
      if (
        expectedPath === undefined ||
        expectedPath.startsWith("--") ||
        revision === undefined ||
        requestId === undefined
      ) {
        console.error(
          "release-root requires <expected.json>, --revision, and --request-id.",
        );
        usage();
      }
      await releaseRoot(
        app,
        expectedPath,
        revision,
        requestId,
        timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S,
        dryRun,
      );
      return;
    }
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
