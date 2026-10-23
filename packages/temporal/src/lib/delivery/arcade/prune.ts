import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  deliverySelectionPatch,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";
import {
  ManagedResourcesSchema,
  parseObject,
  type ManagedResource,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";

const RETIRED_ROUTES = new Set([
  "/Service/arcade-legacy-redirects",
  "networking.k8s.io/Ingress/arcade-mariokart-tailscale-ingress",
  "networking.k8s.io/Ingress/arcade-pokebot-tailscale-ingress",
  "networking.cfargotunnel.com/TunnelBinding/arcade-mariokart-cf-tunnel",
  "networking.cfargotunnel.com/TunnelBinding/arcade-pokebot-cf-tunnel",
]);
const Resource = z.object({
  apiVersion: z.string().min(1),
  kind: z.string().min(1),
  metadata: z.object({
    name: z.string().min(1),
    namespace: z.string().optional(),
    uid: z.string().min(1).optional(),
    deletionTimestamp: z.string().optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});
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
  resource: ManagedResource,
  seen: Set<string>,
) {
  const group = resource.group ?? "";
  const uid = native.metadata.uid;
  if (
    uid === undefined ||
    uid !== cached.metadata.uid ||
    seen.has(uid) ||
    native.apiVersion !== cached.apiVersion ||
    apiGroup(native.apiVersion) !== group ||
    native.kind !== resource.kind ||
    native.metadata.name !== resource.name ||
    native.metadata.namespace !== "arcade" ||
    native.metadata.deletionTimestamp !== undefined ||
    native.metadata.annotations?.["argocd.argoproj.io/hook"] !== undefined ||
    native.metadata.annotations?.["argocd.argoproj.io/tracking-id"] !==
      `arcade:${group}/${resource.kind}:arcade/${resource.name}`
  )
    throw new Error("Retired Arcade route is not the exact owned resource");
  seen.add(uid);
}

/** Retire only Arcade's five legacy hostname objects through its owned release. */
export async function arcadeSyncPrunes(
  selection: DeliverySelection,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  if (selection.application !== "arcade") return false;
  if (
    selection.chart !== "arcade" ||
    selection.namespace !== "arcade" ||
    selection.environmentId !== "arcade/prod"
  )
    throw new Error("Arcade pruning requires its exact registered scope");
  const app = "arcade";
  const before = await read(`${app}?refresh=hard`);
  const frozen = Application.parse(before);
  const patch = deliverySelectionPatch(before, selection);
  if (canonicalJson(patch[2]?.value) !== canonicalJson(frozen.spec.source))
    throw new Error("Arcade source must already match its frozen selection");
  const desired = z
    .object({ manifests: z.array(z.string()) })
    .parse(
      await read(
        `${app}/manifests?revision=${encodeURIComponent(selection.revision)}`,
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
    const group = resource.group ?? "";
    if (
      resource.namespace !== "arcade" ||
      !RETIRED_ROUTES.has(`${group}/${resource.kind}/${resource.name}`)
    )
      throw new Error("Arcade sync refuses unrelated or storage pruning");
    if (
      desired.some(
        (target) =>
          apiGroup(target.apiVersion) === group &&
          target.kind === resource.kind &&
          target.metadata.name === resource.name &&
          (target.metadata.namespace ?? "arcade") === "arcade",
      )
    )
      throw new Error("Arcade prune candidate remains in the selected render");
    const cached = Resource.parse(
      parseObject(resource.liveState, resource, "liveState"),
    );
    const query = new URLSearchParams({
      namespace: "arcade",
      resourceName: resource.name,
      group,
      version: cached.apiVersion.slice(cached.apiVersion.lastIndexOf("/") + 1),
      kind: resource.kind,
    });
    const result = z
      .object({ manifest: z.string() })
      .parse(await read(`${app}/resource?${query.toString()}`));
    const native = Resource.parse(JSON.parse(result.manifest));
    assertOwnedRoute(native, cached, resource, seen);
  }
  const after = await read(app);
  deliverySelectionPatch(after, selection);
  const settled = Application.parse(after);
  if (
    settled.metadata.uid !== frozen.metadata.uid ||
    canonicalJson(settled.spec) !== canonicalJson(frozen.spec)
  )
    throw new Error("Arcade source or Application changed before sync");
  return obsolete.length > 0;
}
