import { z } from "zod";
import { forumNativeObservation as recipe } from "@shepherdjerred/ops-model/forum/native-observation.ts";
import { DeliveryError } from "#domain/error.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import { Metadata } from "./native.ts";

type Resource = (kind: string, name: string) => Promise<unknown>;
const Claim = z.object({
  metadata: Metadata,
  spec: z
    .record(z.string(), z.json())
    .and(z.object({ volumeName: z.string().min(1) })),
  status: z.object({ phase: z.literal("Bound") }),
});
export async function observeForumStorage(resource: Resource) {
  return Promise.all(
    recipe.claims.map(async (name) => {
      const claim = Claim.parse(await resource("PersistentVolumeClaim", name));
      if (claim.metadata.name !== name)
        throw new DeliveryError(
          "CONFLICT",
          "Forum original storage identity differs from its canonical claim",
        );
      return {
        name,
        uid: claim.metadata.uid,
        resourceVersion: claim.metadata.resourceVersion,
        volumeName: claim.spec.volumeName,
        specFingerprint: fingerprint(claim.spec),
      };
    }),
  );
}
export async function requireOriginalDatabase(resource: Resource) {
  const deployment = z
    .object({
      spec: z.object({
        template: z.object({
          spec: z.object({
            volumes: z.array(
              z.object({
                name: z.string(),
                persistentVolumeClaim: z
                  .object({ claimName: z.string() })
                  .optional(),
              }),
            ),
          }),
        }),
      }),
    })
    .parse(await resource("Deployment", "storm-forum-database"));
  if (
    !deployment.spec.template.spec.volumes.some(
      (volume) =>
        volume.name === "database" &&
        volume.persistentVolumeClaim?.claimName === "storm-forum-database",
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum database workload no longer uses its original claim",
    );
}
