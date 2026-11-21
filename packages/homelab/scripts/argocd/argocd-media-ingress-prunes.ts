import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "#scripts/canonical-json.ts";
import { parseObject, type ManagedResource } from "./argocd-apply-safety.ts";

export const MEDIA_INGRESS_PRUNE_INFO = "ci.sjer.red/media-ingress-prunes";
export const MEDIA_INGRESS_PRUNE_FLAG = "--expected-media-ingress-prunes";
export const LEGACY_MEDIA_ROUTES = [
  "bazarr",
  "maintainerr",
  "prowlarr",
  "radarr",
  "seerr",
  "sonarr",
  "tautulli",
] as const;

const legacyNames = new Set<string>(
  LEGACY_MEDIA_ROUTES.map((app) => `media-${app}-tailscale-ingress-ingress`),
);
export const MediaIngressIdentity = z.object({
  group: z.literal("networking.k8s.io"),
  kind: z.literal("Ingress"),
  namespace: z.literal("media"),
  name: z.string().refine((name) => legacyNames.has(name)),
});
const ReviewedIngress = MediaIngressIdentity.extend({ uid: z.string().min(1) });
const LiveOwner = z.object({
  metadata: z.object({
    uid: z.string(),
    annotations: z.object({ "argocd.argoproj.io/tracking-id": z.string() }),
  }),
});
const ExpectedPruning = z.object({
  applicationUid: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  resources: z
    .array(ReviewedIngress)
    .min(1)
    .max(LEGACY_MEDIA_ROUTES.length)
    .refine(
      (resources) =>
        new Set(resources.map(({ name }) => name)).size === resources.length,
    ),
});
export type MediaIngressPruning = z.infer<typeof ExpectedPruning>;

export function parseMediaIngressPruning(value: string): MediaIngressPruning {
  return ExpectedPruning.parse(JSON.parse(value));
}

export function mediaIngressPruneInfo(
  info: readonly { name: string; value: string }[],
): string | undefined {
  const entries = info.filter(({ name }) => name === MEDIA_INGRESS_PRUNE_INFO);
  if (entries.length > 1)
    throw new Error("Argo operation has ambiguous Media ingress prune scopes");
  return entries[0]?.value;
}

export function mediaIngressSourceHash(source: unknown): string {
  return createHash("sha256").update(canonicalJson(source)).digest("hex");
}

/** Compare the fresh managed list after attaching only the exact revision's rendered targets. */
export function assertMediaIngressPruneInventory(
  expected: MediaIngressPruning,
  source: unknown,
  scoped: readonly ManagedResource[],
): void {
  if (mediaIngressSourceHash(source) !== expected.sourceHash)
    throw new Error("Media ingress prune source changed before sync");
  const remaining = new Map(
    expected.resources.map(({ name, uid }) => [name, uid]),
  );
  for (const resource of scoped) {
    const live = parseObject(resource.liveState, resource, "liveState");
    const target = parseObject(resource.targetState, resource, "targetState");
    if (live === null || target !== null) continue;
    const identity = MediaIngressIdentity.safeParse(resource);
    if (!identity.success || !remaining.has(identity.data.name))
      throw new Error(
        `Media ingress prune inventory changed before sync: unexpected ${resource.kind} ${resource.name}`,
      );
    const owner = LiveOwner.safeParse(live);
    if (
      !owner.success ||
      owner.data.metadata.uid !== remaining.get(identity.data.name) ||
      owner.data.metadata.annotations["argocd.argoproj.io/tracking-id"] !==
        `media:networking.k8s.io/Ingress:media/${identity.data.name}`
    ) {
      throw new Error(
        `Media ingress ${identity.data.name} ownership changed before sync`,
      );
    }
    remaining.delete(identity.data.name);
  }
  if (remaining.size > 0)
    throw new Error(
      "Media ingress prune inventory changed before sync: reviewed ingresses are absent",
    );
}

export function hasLiveLegacyMediaIngresses(
  managed: readonly ManagedResource[],
): boolean {
  return managed.some(
    (resource) =>
      resource.kind === "Ingress" &&
      legacyNames.has(resource.name) &&
      parseObject(resource.liveState, resource, "liveState") !== null,
  );
}
