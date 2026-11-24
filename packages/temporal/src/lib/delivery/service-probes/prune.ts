import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { ArgoResourceSchema as Resource } from "#lib/delivery/argocd-proof.ts";
import type { RetiredRouteRelease } from "#lib/delivery/retired-route-prune.ts";
import {
  ManagedResourcesSchema,
  parseObject,
  type ManagedResource,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";

const APPLICATION = "service-probes";
const CHART = "service-probes";
const NAMESPACE = "prometheus";
const ENVIRONMENT_ID = "service-probes/prod";
const GROUP = "monitoring.coreos.com";
const KIND = "Probe";
const PROBE_PREFIX = "probe-";
const LABEL = "Service probes";

const Application = z.object({
  metadata: z.object({ uid: z.string().min(1) }),
  spec: z.object({ source: z.unknown() }).loose(),
});

function apiGroup(apiVersion: string): string {
  return apiVersion.includes("/")
    ? apiVersion.slice(0, apiVersion.indexOf("/"))
    : "";
}

function assertOwnedProbe(
  native: z.infer<typeof Resource>,
  cached: z.infer<typeof Resource>,
  resource: ManagedResource,
  seen: Set<string>,
): void {
  const uid = native.metadata.uid;
  if (
    uid === undefined ||
    uid !== cached.metadata.uid ||
    seen.has(uid) ||
    native.apiVersion !== cached.apiVersion ||
    apiGroup(native.apiVersion) !== GROUP ||
    native.kind !== KIND ||
    cached.kind !== KIND ||
    native.metadata.name !== resource.name ||
    cached.metadata.name !== resource.name ||
    native.metadata.namespace !== NAMESPACE ||
    cached.metadata.namespace !== NAMESPACE ||
    native.metadata.deletionTimestamp !== undefined ||
    native.metadata.annotations?.["argocd.argoproj.io/hook"] !== undefined ||
    native.metadata.annotations?.["argocd.argoproj.io/tracking-id"] !==
      `${APPLICATION}:${GROUP}/${KIND}:${NAMESPACE}/${resource.name}`
  ) {
    throw new Error(`Retired ${LABEL} probe is not the exact owned resource`);
  }
  seen.add(uid);
}

async function verifyObsoleteProbe(input: {
  app: string;
  resource: ManagedResource;
  desired: readonly z.infer<typeof Resource>[];
  read: (path: string) => Promise<unknown>;
  seen: Set<string>;
}): Promise<void> {
  const { app, resource, desired, read, seen } = input;
  const group = resource.group ?? "";
  if (
    group !== GROUP ||
    resource.namespace !== NAMESPACE ||
    resource.kind !== KIND ||
    !resource.name.startsWith(PROBE_PREFIX)
  ) {
    throw new Error(`${LABEL} sync refuses unrelated or storage pruning`);
  }
  const remainsRendered = desired.some(
    (target) =>
      apiGroup(target.apiVersion) === GROUP &&
      target.kind === KIND &&
      target.metadata.name === resource.name &&
      (target.metadata.namespace ?? NAMESPACE) === NAMESPACE,
  );
  if (remainsRendered) {
    throw new Error(`${LABEL} prune candidate remains in the selected render`);
  }
  const cached = Resource.parse(
    parseObject(resource.liveState, resource, "liveState"),
  );
  if (apiGroup(cached.apiVersion) !== GROUP) {
    throw new Error(`Retired ${LABEL} probe is not the exact owned resource`);
  }
  const query = new URLSearchParams({
    namespace: NAMESPACE,
    resourceName: resource.name,
    group: GROUP,
    version: cached.apiVersion.slice(cached.apiVersion.lastIndexOf("/") + 1),
    kind: KIND,
  });
  const result = z
    .object({ manifest: z.string() })
    .parse(await read(`${app}/resource?${query.toString()}`));
  const native = Resource.parse(JSON.parse(result.manifest));
  assertOwnedProbe(native, cached, resource, seen);
}

/**
 * Whether the owned sync of `release` prunes retired `Probe` CRs for
 * `service-probes`. False for every other application. For `service-probes` it
 * requires the exact registered scope, a stable frozen source before and after
 * inspection, and that every obsolete managed resource is an owned
 * `monitoring.coreos.com` `Probe` named `probe-*` in `prometheus` that is
 * absent from the selected render.
 */
export async function serviceProbesSyncPrunes(
  release: RetiredRouteRelease,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  if (release.application !== APPLICATION) return false;
  if (
    release.chart !== CHART ||
    release.namespace !== NAMESPACE ||
    release.environmentId !== ENVIRONMENT_ID
  ) {
    throw new Error(`${LABEL} pruning requires its exact registered scope`);
  }
  const app = encodeURIComponent(APPLICATION);
  const before = await read(`${app}?refresh=hard`);
  const frozen = Application.parse(before);
  if (
    canonicalJson(release.source(before)) !== canonicalJson(frozen.spec.source)
  ) {
    throw new Error(`${LABEL} source must already match its frozen selection`);
  }
  const desired = z
    .object({ manifests: z.array(z.string()) })
    .parse(
      await read(
        `${app}/manifests?revision=${encodeURIComponent(release.revision)}`,
      ),
    )
    .manifests.map((manifest) => Resource.parse(JSON.parse(manifest)));
  const managed = ManagedResourcesSchema.parse(
    await read(`${app}/managed-resources`),
  ).items;
  const obsolete = managed.filter(
    (resource) =>
      parseObject(resource.liveState, resource, "liveState") !== null &&
      parseObject(resource.targetState, resource, "targetState") === null,
  );
  const seen = new Set<string>();
  for (const resource of obsolete) {
    await verifyObsoleteProbe({ app, resource, desired, read, seen });
  }
  const after = await read(app);
  release.source(after);
  const settled = Application.parse(after);
  if (
    settled.metadata.uid !== frozen.metadata.uid ||
    canonicalJson(settled.spec) !== canonicalJson(frozen.spec)
  ) {
    throw new Error(`${LABEL} source or Application changed before sync`);
  }
  return obsolete.length > 0;
}
