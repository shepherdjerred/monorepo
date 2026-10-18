import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
const SourceRevision = z.string().regex(/^[a-f0-9]{40}$/u);
export const WorkerRolloutPlanSchema = z
  .object({
    target: z.enum(["central", "scout-beta", "scout-prod"]),
    namespace: z.enum(["beta", "prod"]),
    deploymentName: IdentifierSchema,
    taskQueue: IdentifierSchema,
    candidateBuildId: SourceRevision,
    candidateImage: z
      .string()
      .regex(/^docker\.io\/shepherdjerred\/[\w-]+@sha256:[a-f0-9]{64}$/u),
    expectedCurrentBuildId: SourceRevision,
    routes: z
      .array(
        z
          .object({
            namespace: z.enum(["prod", "beta"]),
            expectedCurrentBuildId: SourceRevision,
          })
          .strict(),
      )
      .max(2)
      .default([]),
    deploymentId: IdentifierSchema,
  })
  .strict();
export const WorkerRolloutActionSchema = z.enum(["promote", "verify"]);
