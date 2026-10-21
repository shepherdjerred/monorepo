import { z } from "zod";
import { ArtifactVersionSchema } from "#shared/artifact-contract.ts";

/**
 * What admission froze into a deployment (Z1, A5, C2): the accepted
 * selection of every prerequisite environment, the runner artifacts the
 * recipe binds by reference, and the artifacts accepted elsewhere that
 * `acceptedIn` parameters name. A retry rechecks the prerequisites; the
 * executor renders only what is frozen here.
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
  references: z.record(z.string().min(1), ArtifactVersionSchema),
});
export type AdmissionSnapshot = z.infer<typeof AdmissionSnapshotSchema>;
