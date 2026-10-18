import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";

export const CreateDeploymentSchema = z
  .object({
    requestId: IdentifierSchema,
    environmentId: IdentifierSchema,
    versionSetRevisionId: IdentifierSchema,
    expectedGeneration: z.number().int().nonnegative(),
    kind: z
      .enum(["deploy", "promote", "rollback", "adopt-worker"])
      .default("deploy"),
    sourceEnvironmentId: IdentifierSchema.optional(),
    workerBaseline: z
      .strictObject({
        artifactIds: z.array(IdentifierSchema).min(1).max(100),
        candidateArtifactId: IdentifierSchema,
      })
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      (input.kind === "adopt-worker") !==
      (input.workerBaseline !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Host-only worker adoption requires its explicit original artifact selection",
      });
    const baseline = input.workerBaseline;
    if (
      baseline !== undefined &&
      (new Set(baseline.artifactIds).size !== baseline.artifactIds.length ||
        !baseline.artifactIds.includes(baseline.candidateArtifactId))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Baseline artifacts must be unique and include the routed candidate",
      });
  });
