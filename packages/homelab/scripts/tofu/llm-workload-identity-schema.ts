import { z } from "zod";

/**
 * The shape of `llm-workload-identity.json`, shared by the CDK8s helper that
 * reads it and the OpenTofu export action that writes it. It lives beside the
 * export and depends on zod alone, so CDK8s imports it the way it imports the
 * other platform desired-state contracts.
 */
const WorkloadSchema = z.strictObject({
  federation_rule_id: z.string().startsWith("fdrl_"),
  service_account_id: z.string().startsWith("svac_"),
  workspace_id: z.string().startsWith("wrkspc_"),
});

export const LlmWorkloadIdentitySchema = z.strictObject({
  anthropic: z
    .strictObject({
      organization_id: z.string().min(1).nullable(),
      workloads: z.record(z.string().min(1), WorkloadSchema),
    })
    .refine(
      (anthropic) =>
        Object.keys(anthropic.workloads).length === 0 ||
        anthropic.organization_id !== null,
      {
        message:
          "anthropic.organization_id is required once any workload is federated",
      },
    ),
});
export type LlmWorkloadIdentity = z.infer<typeof LlmWorkloadIdentitySchema>;
