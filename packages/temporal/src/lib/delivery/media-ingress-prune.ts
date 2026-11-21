import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  parseObject,
  type ManagedResource,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";
import { ArgoResourceSchema } from "./argocd-proof.ts";
import {
  LEGACY_MEDIA_ROUTES,
  MediaIngressIdentity,
  type MediaIngressPruning,
} from "homelab/scripts/argocd/argocd-media-ingress-prunes.ts";

const WRITERS = [...LEGACY_MEDIA_ROUTES, "recyclarr", "whisperbridge"];
const INGRESS_SERVICES = new Map<string, string>(
  LEGACY_MEDIA_ROUTES.map((app) => [
    `media-${app}-tailscale-ingress-ingress`,
    `media-${app}-service`,
  ]),
);
const GROUP = "networking.k8s.io";
const Ingress = ArgoResourceSchema.extend({
  apiVersion: z.literal(`${GROUP}/v1`),
  kind: z.literal("Ingress"),
  metadata: ArgoResourceSchema.shape.metadata.extend({
    namespace: z.literal("media"),
    uid: z.string().min(1),
    finalizers: z.tuple([z.literal("tailscale.com/finalizer")]),
    ownerReferences: z.tuple([]).optional(),
  }),
  spec: z.looseObject({
    ingressClassName: z.literal("tailscale"),
    defaultBackend: z.looseObject({
      service: z.looseObject({ name: z.string() }),
    }),
  }),
});
const StoppedWriter = z.object({
  apiVersion: z.literal("apps/v1"),
  spec: z.object({ replicas: z.literal(0) }),
});
const SeerrRoute = z.object({
  apiVersion: z.literal("networking.cfargotunnel.com/v1alpha1"),
  metadata: z.object({
    finalizers: z.tuple([z.literal("cfargotunnel.com/finalizer")]),
  }),
  subjects: z.tuple([
    z.object({
      kind: z.literal("Service"),
      name: z.literal("media-api"),
      spec: z.object({ fqdn: z.literal("seerr.sjer.red") }),
    }),
  ]),
  tunnelRef: z.object({
    kind: z.literal("ClusterTunnel"),
    name: z.literal("homelab-tunnel"),
    disableDNSUpdates: z.literal(true),
  }),
});

type DesiredResource = z.infer<typeof ArgoResourceSchema>;

function desiredMediaResource(
  desired: readonly DesiredResource[],
  kind: string,
  name: string,
): DesiredResource | undefined {
  const matches = desired.filter(
    (resource) =>
      resource.kind === kind &&
      resource.metadata.name === name &&
      (resource.metadata.namespace ?? "media") === "media",
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function assertCutoverChart(desired: readonly DesiredResource[]) {
  if (
    desired.some(
      ({ kind, metadata }) =>
        kind === "Ingress" && INGRESS_SERVICES.has(metadata.name),
    ) ||
    WRITERS.some(
      (app) =>
        !StoppedWriter.safeParse(
          desiredMediaResource(desired, "Deployment", `media-${app}`),
        ).success,
    ) ||
    !SeerrRoute.safeParse(
      desiredMediaResource(desired, "TunnelBinding", "media-seerr-cf-tunnel"),
    ).success
  )
    throw new Error(
      "Frozen chart does not render the exact Media ingress retirement",
    );
}

function assertOwnedIngress(raw: unknown, name: string, service: string) {
  const result = Ingress.safeParse(raw);
  if (!result.success)
    throw new Error(`Media ingress ${name} is not the exact owned resource`);
  const { metadata, spec } = result.data;
  if (
    metadata.name !== name ||
    metadata.deletionTimestamp !== undefined ||
    metadata.annotations?.["argocd.argoproj.io/tracking-id"] !==
      `media:${GROUP}/Ingress:media/${name}` ||
    metadata.annotations["argocd.argoproj.io/hook"] !== undefined ||
    metadata.annotations["argocd.argoproj.io/sync-options"] !== undefined ||
    spec.defaultBackend.service.name !== service
  )
    throw new Error(`Media ingress ${name} is not the exact owned resource`);
  return result.data;
}

export async function proveMediaIngressPrunes(input: {
  desired: readonly DesiredResource[];
  obsolete: readonly ManagedResource[];
  readNative: (resource: ManagedResource) => Promise<unknown>;
}): Promise<MediaIngressPruning["resources"]> {
  assertCutoverChart(input.desired);
  const names = new Set<string>();
  const uids = new Set<string>();
  const resources: MediaIngressPruning["resources"] = [];
  for (const resource of input.obsolete) {
    const { group, kind, name, namespace } = resource;
    const service = INGRESS_SERVICES.get(name);
    if (
      group !== GROUP ||
      kind !== "Ingress" ||
      namespace !== "media" ||
      service === undefined ||
      names.has(name)
    )
      throw new Error(
        "Media ingress sync refuses unrelated or ambiguous pruning",
      );
    const cached = assertOwnedIngress(
      parseObject(resource.liveState, resource, "liveState"),
      name,
      service,
    );
    const native = assertOwnedIngress(
      await input.readNative(resource),
      name,
      service,
    );
    if (
      native.metadata.uid !== cached.metadata.uid ||
      uids.has(native.metadata.uid) ||
      canonicalJson(native.spec) !== canonicalJson(cached.spec)
    )
      throw new Error(`Media ingress ${name} changed before sync`);
    names.add(name);
    uids.add(native.metadata.uid);
    resources.push({
      ...MediaIngressIdentity.parse(resource),
      uid: native.metadata.uid,
    });
  }
  return resources;
}
