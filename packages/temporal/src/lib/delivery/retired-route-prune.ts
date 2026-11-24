import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { ArgoResourceSchema as Resource } from "#lib/delivery/argocd-proof.ts";
import { requireRenderedSource } from "#lib/delivery/model/application-proof.ts";
import type { RenderedApplication } from "#lib/delivery/model/application.ts";
import {
  deliverySelectionPatch,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";
import {
  ManagedResourcesSchema,
  parseObject,
  type ManagedResource,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";
import {
  assertRetiredEnforcementStagingPolicy,
  enforcementStagingNamespace,
} from "#lib/delivery/network-policy/enforcement-staging-prune.ts";

/**
 * One application's reviewed resource retirement: its exact registered scope
 * and either the explicit `group/Kind/name` route identities or a bounded
 * predicate over `{ group, kind, name }` that its owned sync may prune. `label`
 * names the application in refusals; `resourceNoun` defaults to `"route"`.
 */
type RetiredRouteRuleBase = {
  application: string;
  chart: string;
  namespace: string;
  environmentId: string;
  label: string;
  resourceNoun?: string;
};

export type RetiredRouteRule =
  | (RetiredRouteRuleBase & { routes: ReadonlySet<string> })
  | (RetiredRouteRuleBase & {
      matches: (resource: {
        group: string;
        kind: string;
        name: string;
      }) => boolean;
    });

/**
 * The release about to be synced, from either Delivery generation. `source`
 * reads an Application and returns the exact source this release must find
 * on it, throwing when the Application is not this release's to sync.
 */
export type RetiredRouteRelease = {
  application: string;
  chart: string | undefined;
  namespace: string | undefined;
  environmentId: string;
  revision: string;
  source: (application: unknown) => unknown;
};

/** A v1 release: its selection's patch over the Application is the source. */
export function selectionRelease(
  selection: DeliverySelection,
): RetiredRouteRelease {
  return {
    application: selection.application,
    chart: selection.chart,
    namespace: selection.namespace,
    environmentId: selection.environmentId,
    revision: selection.revision,
    source: (application) =>
      deliverySelectionPatch(application, selection)[2]?.value,
  };
}

/**
 * A model release: the apply-safety step already wrote the rendered source,
 * so the Application must carry exactly it with no operation in flight.
 */
export function renderedRelease(
  rendered: RenderedApplication,
): RetiredRouteRelease {
  return {
    application: rendered.name,
    chart: "chart" in rendered.source ? rendered.source.chart : undefined,
    namespace: rendered.body.spec.destination.namespace,
    environmentId: rendered.environmentId,
    revision: rendered.revision,
    source: (application) => {
      const observed = requireRenderedSource(application, rendered);
      if (
        ["Running", "Terminating"].includes(
          observed.status.operationState?.phase ?? "",
        )
      )
        throw new Error(
          "Application operation is not settled; retain Delivery ownership",
        );
      return rendered.source;
    },
  };
}

const Application = z.object({
  metadata: z.object({ uid: z.string().min(1) }),
  spec: z.object({ source: z.unknown() }).loose(),
});

function apiGroup(apiVersion: string): string {
  return apiVersion.includes("/")
    ? apiVersion.slice(0, apiVersion.indexOf("/"))
    : "";
}

function assertOwnedRoute(
  native: z.infer<typeof Resource>,
  cached: z.infer<typeof Resource>,
  context: {
    rule: RetiredRouteRule;
    resource: ManagedResource;
    seen: Set<string>;
  },
) {
  const { rule, resource, seen } = context;
  const group = resource.group ?? "";
  const noun = rule.resourceNoun ?? "route";
  const uid = native.metadata.uid;
  if (
    uid === undefined ||
    uid !== cached.metadata.uid ||
    seen.has(uid) ||
    native.apiVersion !== cached.apiVersion ||
    apiGroup(native.apiVersion) !== group ||
    native.kind !== resource.kind ||
    cached.kind !== resource.kind ||
    native.metadata.name !== resource.name ||
    cached.metadata.name !== resource.name ||
    native.metadata.namespace !== rule.namespace ||
    cached.metadata.namespace !== rule.namespace ||
    native.metadata.deletionTimestamp !== undefined ||
    native.metadata.annotations?.["argocd.argoproj.io/hook"] !== undefined ||
    native.metadata.annotations?.["argocd.argoproj.io/tracking-id"] !==
      `${rule.application}:${group}/${resource.kind}:${rule.namespace}/${resource.name}`
  )
    throw new Error(
      `Retired ${rule.label} ${noun} is not the exact owned resource`,
    );
  seen.add(uid);
}

/**
 * Whether the owned sync of `release` prunes. False for every other
 * application. For the rule's application it requires the exact registered
 * scope, a stable frozen source, and that every obsolete managed resource is
 * one of the rule's routes, absent from the selected render, and the exact
 * live object Argo tracks for this application; anything else throws, so
 * storage and unrelated resources are never pruned.
 */
export async function retiredRouteSyncPrunes(
  rule: RetiredRouteRule,
  release: RetiredRouteRelease,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  if (release.application !== rule.application) return false;
  if (
    release.chart !== rule.chart ||
    release.namespace !== rule.namespace ||
    release.environmentId !== rule.environmentId
  )
    throw new Error(
      `${rule.label} pruning requires its exact registered scope`,
    );
  const app = encodeURIComponent(rule.application);
  const before = await read(`${app}?refresh=hard`);
  const frozen = Application.parse(before);
  if (
    canonicalJson(release.source(before)) !== canonicalJson(frozen.spec.source)
  )
    throw new Error(
      `${rule.label} source must already match its frozen selection`,
    );
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
    const stagingNamespace =
      "routes" in rule
        ? enforcementStagingNamespace(resource, rule.namespace)
        : null;
    if (stagingNamespace !== null) {
      await assertRetiredEnforcementStagingPolicy({
        application: rule.application,
        resource: { ...resource, namespace: stagingNamespace },
        desired,
        defaultNamespace: rule.namespace,
        read,
        seen,
      });
      continue;
    }
    const group = resource.group ?? "";
    const allowed =
      "routes" in rule
        ? rule.routes.has(`${group}/${resource.kind}/${resource.name}`)
        : rule.matches({ group, kind: resource.kind, name: resource.name });
    if (!allowed || resource.namespace !== rule.namespace)
      throw new Error(
        `${rule.label} sync refuses unrelated or storage pruning`,
      );
    if (
      desired.some(
        (target) =>
          apiGroup(target.apiVersion) === group &&
          target.kind === resource.kind &&
          target.metadata.name === resource.name &&
          (target.metadata.namespace ?? rule.namespace) === rule.namespace,
      )
    )
      throw new Error(
        `${rule.label} prune candidate remains in the selected render`,
      );
    const cached = Resource.parse(
      parseObject(resource.liveState, resource, "liveState"),
    );
    const query = new URLSearchParams({
      namespace: rule.namespace,
      resourceName: resource.name,
      group,
      version: cached.apiVersion.slice(cached.apiVersion.lastIndexOf("/") + 1),
      kind: resource.kind,
    });
    const result = z
      .object({ manifest: z.string() })
      .parse(await read(`${app}/resource?${query.toString()}`));
    const native = Resource.parse(JSON.parse(result.manifest));
    assertOwnedRoute(native, cached, { rule, resource, seen });
  }
  const after = await read(app);
  release.source(after);
  const settled = Application.parse(after);
  if (
    settled.metadata.uid !== frozen.metadata.uid ||
    canonicalJson(settled.spec) !== canonicalJson(frozen.spec)
  )
    throw new Error(`${rule.label} source or Application changed before sync`);
  return obsolete.length > 0;
}
