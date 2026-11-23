import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  parseObject,
  type ManagedResource,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";

const GROUP = "networking.k8s.io";
const KIND = "NetworkPolicy";
const PREFIX = "enforcement-staging-";
const STAGE_ANNOTATION = "homelab.sjer.red/enforcement-stage";
const STAGING_LABEL = "homelab.sjer.red/enforcement-staging";

const StagingCandidateSchema = z.object({
  group: z.literal(GROUP),
  kind: z.literal(KIND),
  namespace: z.string().min(1),
  name: z.string().min(1),
});

const EnforcementStagingPolicySchema = z.object({
  apiVersion: z.literal(`${GROUP}/v1`),
  kind: z.literal(KIND),
  metadata: z.object({
    name: z.string().min(1),
    namespace: z.string().min(1),
    uid: z.string().min(1),
    deletionTimestamp: z.string().optional(),
    finalizers: z.array(z.string()).optional(),
    ownerReferences: z.array(z.unknown()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.looseObject({
    podSelector: z.strictObject({
      matchLabels: z.strictObject({
        [STAGING_LABEL]: z.literal("never"),
      }),
    }),
  }),
});

type EnforcementStagingPolicy = z.infer<typeof EnforcementStagingPolicySchema>;

export type DesiredResourceIdentity = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string | undefined;
  };
};

function apiGroup(apiVersion: string): string {
  return apiVersion.includes("/")
    ? apiVersion.slice(0, apiVersion.indexOf("/"))
    : "";
}

/**
 * Returns the target namespace when `resource` names a retired per-namespace
 * NetworkPolicy enforcement-staging object (#5035), optionally scoped to
 * `expectedNamespace`. Flipt retains its open policy until namespace
 * retirement and is never a staging-prune candidate.
 */
export function enforcementStagingNamespace(
  resource: Pick<ManagedResource, "group" | "kind" | "name" | "namespace">,
  expectedNamespace?: string,
): string | null {
  const parsed = StagingCandidateSchema.safeParse(resource);
  if (!parsed.success) return null;
  const { namespace, name } = parsed.data;
  if (namespace === "flipt" || name !== `${PREFIX}${namespace}`) return null;
  return expectedNamespace === undefined || namespace === expectedNamespace
    ? namespace
    : null;
}

function assertAbsentFromRender(
  resource: { name: string; namespace: string },
  desired: readonly DesiredResourceIdentity[],
  defaultNamespace: string | undefined,
): void {
  const stillRendered = desired.some(
    (target) =>
      apiGroup(target.apiVersion) === GROUP &&
      target.kind === KIND &&
      target.metadata.name === resource.name &&
      (target.metadata.namespace ?? defaultNamespace) === resource.namespace,
  );
  if (stillRendered) {
    throw new Error(
      `Retired enforcement-staging policy ${resource.namespace}/${resource.name} remains in the selected render`,
    );
  }
}

function parseStagingPolicy(
  raw: unknown,
  resource: { name: string; namespace: string },
): EnforcementStagingPolicy {
  const parsed = EnforcementStagingPolicySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Enforcement-staging policy ${resource.namespace}/${resource.name} is not an inert enforced NetworkPolicy`,
    );
  }
  return parsed.data;
}

function hasCleanLifecycleMetadata(
  metadata: EnforcementStagingPolicy["metadata"],
): boolean {
  const syncOptions =
    metadata.annotations?.["argocd.argoproj.io/sync-options"]
      ?.split(",")
      .map((entry) => entry.trim()) ?? [];
  return (
    metadata.deletionTimestamp === undefined &&
    (metadata.finalizers?.length ?? 0) === 0 &&
    (metadata.ownerReferences?.length ?? 0) === 0 &&
    metadata.annotations?.["argocd.argoproj.io/hook"] === undefined &&
    !syncOptions.includes("Prune=false")
  );
}

function matchesOwnedEnforcedIdentity(input: {
  application: string;
  resource: { name: string; namespace: string };
  native: EnforcementStagingPolicy;
  cached: EnforcementStagingPolicy;
  seen: Set<string>;
}): boolean {
  const { application, resource, native, cached, seen } = input;
  const { metadata } = native;
  const expectedTrackingId = `${application}:${GROUP}/${KIND}:${resource.namespace}/${resource.name}`;
  return (
    metadata.uid === cached.metadata.uid &&
    !seen.has(metadata.uid) &&
    metadata.name === resource.name &&
    metadata.namespace === resource.namespace &&
    cached.metadata.name === resource.name &&
    cached.metadata.namespace === resource.namespace &&
    metadata.annotations?.["argocd.argoproj.io/tracking-id"] ===
      expectedTrackingId &&
    metadata.annotations[STAGE_ANNOTATION] === "enforced" &&
    cached.metadata.annotations?.[STAGE_ANNOTATION] === "enforced" &&
    canonicalJson(native.spec) === canonicalJson(cached.spec)
  );
}

/**
 * Prove that an obsolete `enforcement-staging-<ns>` NetworkPolicy is absent
 * from the selected render, tracked by `application`, already in the
 * `enforced` stage, and selects zero pods (`homelab.sjer.red/enforcement-staging: never`).
 */
export async function assertRetiredEnforcementStagingPolicy(input: {
  application: string;
  resource: ManagedResource & { namespace: string };
  desired: readonly DesiredResourceIdentity[];
  defaultNamespace: string | undefined;
  read: (path: string) => Promise<unknown>;
  seen: Set<string>;
}): Promise<void> {
  const { application, resource, desired, defaultNamespace, read, seen } =
    input;
  assertAbsentFromRender(resource, desired, defaultNamespace);

  const cached = parseStagingPolicy(
    parseObject(resource.liveState, resource, "liveState"),
    resource,
  );
  const query = new URLSearchParams({
    namespace: resource.namespace,
    resourceName: resource.name,
    group: GROUP,
    version: "v1",
    kind: KIND,
  });
  const response = z
    .object({ manifest: z.string() })
    .parse(
      await read(
        `${encodeURIComponent(application)}/resource?${query.toString()}`,
      ),
    );
  const native = parseStagingPolicy(JSON.parse(response.manifest), resource);

  if (
    !hasCleanLifecycleMetadata(native.metadata) ||
    !matchesOwnedEnforcedIdentity({
      application,
      resource,
      native,
      cached,
      seen,
    })
  ) {
    throw new Error(
      `Enforcement-staging policy ${resource.namespace}/${resource.name} is not the exact owned enforced resource`,
    );
  }

  seen.add(native.metadata.uid);
}
