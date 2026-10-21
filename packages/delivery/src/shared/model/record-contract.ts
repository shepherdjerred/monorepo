import { z } from "zod";
import { IdentifierSchema } from "#shared/artifact-contract.ts";

/** An immutable configuration revision as the record stores it (model 4.8). */
export const ConfigurationRevisionSchema = z.object({
  id: IdentifierSchema,
  content: z.record(z.string(), z.string()),
  forwardOnly: z.array(z.string()).default([]),
});
export type ConfigurationRevision = z.infer<typeof ConfigurationRevisionSchema>;

/** The executor workflow that owns a deployment for its lease (model D7). */
export const ExecutorIdentitySchema = z
  .object({
    workflowId: z.string().min(1).max(200),
    workflowRunId: z.string().min(1).max(200),
  })
  .strict();
export type ExecutorIdentity = z.infer<typeof ExecutorIdentitySchema>;
