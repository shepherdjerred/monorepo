import { z } from "zod";
import { LEGACY_DEPLOYMENTS } from "./config.ts";
import type { Resource } from "./wire.ts";

const Container = z.object({
  volumeMounts: z
    .array(z.object({ name: z.string(), readOnly: z.boolean().optional() }))
    .default([]),
});
const PodSpec = z.object({
  containers: z.array(Container).default([]),
  initContainers: z.array(Container).default([]),
  ephemeralContainers: z.array(Container).default([]),
  volumes: z
    .array(
      z.object({
        name: z.string(),
        persistentVolumeClaim: z
          .object({ claimName: z.string(), readOnly: z.boolean().optional() })
          .optional(),
      }),
    )
    .default([]),
});
function podSpec(item: Resource) {
  if (item.kind === "Pod") return PodSpec.parse(item.spec);
  if (item.kind === "CronJob") {
    return z
      .object({
        jobTemplate: z.object({
          spec: z.object({ template: z.object({ spec: PodSpec }) }),
        }),
      })
      .parse(item.spec).jobTemplate.spec.template.spec;
  }
  const parsed = z
    .object({ template: z.object({ spec: PodSpec }) })
    .safeParse(item.spec);
  return parsed.success ? parsed.data.template.spec : undefined;
}
export function relevantClaimNames(resources: Resource[]) {
  const names = new Set<string>();
  for (const item of resources) {
    if (!LEGACY_DEPLOYMENTS.includes(item.metadata.name)) continue;
    for (const volume of podSpec(item)?.volumes ?? []) {
      if (volume.persistentVolumeClaim !== undefined)
        names.add(volume.persistentVolumeClaim.claimName);
    }
  }
  return names;
}
export function possibleLegacyWriter(
  item: Resource,
  claims: Set<string>,
): boolean {
  if (
    LEGACY_DEPLOYMENTS.some((name) => item.metadata.name.startsWith(`${name}-`))
  )
    return true;
  // This checks only in-memory specs: never persist env values or command strings.
  const serialized = JSON.stringify(item.spec).toLowerCase();
  return (
    LEGACY_DEPLOYMENTS.some((name) =>
      serialized.includes(name.slice("media-".length)),
    ) || writesRelevantClaim(item, claims)
  );
}
export function writesRelevantClaim(
  item: Resource,
  claims: Set<string>,
): boolean {
  const pod = podSpec(item);
  if (pod === undefined) return false;
  const volumes = new Set(
    pod.volumes
      .filter(
        (volume) =>
          volume.persistentVolumeClaim !== undefined &&
          volume.persistentVolumeClaim.readOnly !== true &&
          claims.has(volume.persistentVolumeClaim.claimName),
      )
      .map((volume) => volume.name),
  );
  return [
    ...pod.containers,
    ...pod.initContainers,
    ...pod.ephemeralContainers,
  ].some((container) =>
    container.volumeMounts.some(
      (mount) => mount.readOnly !== true && volumes.has(mount.name),
    ),
  );
}
