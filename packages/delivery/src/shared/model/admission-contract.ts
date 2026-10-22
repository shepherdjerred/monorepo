import { z } from "zod";
import { ArtifactVersionSchema } from "#shared/artifact-contract.ts";

/**
 * What admission froze into a deployment (Z1, A5, C2): the accepted
 * selection of every prerequisite environment, the runner artifacts the
 * recipe binds by reference. Artifacts another environment accepted reach
 * a recipe through tracking reference components of its own selection (A5).
 * A retry rechecks the prerequisites.
 */
export const AdmissionSnapshotSchema = z.strictObject({
  prerequisites: z.array(
    z.strictObject({
      environmentId: z.string().min(1),
      rule: z.enum(["any-accepted", "same-or-later-order-key"]),
      deploymentId: z.string().min(1),
      versionSetRevisionId: z.string().min(1),
      orderKey: z.string().nullable(),
    }),
  ),
  runners: z.array(
    z.strictObject({
      service: z.string().min(1),
      component: z.string().min(1),
      artifact: ArtifactVersionSchema,
    }),
  ),
});
export type AdmissionSnapshot = z.infer<typeof AdmissionSnapshotSchema>;
