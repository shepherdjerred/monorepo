import {
  LlmWorkloadIdentitySchema,
  type LlmWorkloadIdentity,
} from "./llm-workload-identity-schema.ts";

/** The committed inventory CDK8s reads when it wires federated workloads. */
export const WORKLOAD_IDENTITY_INVENTORY_PATH =
  "src/cdk8s/src/misc/llm-workload-identity.json";

/** The one output the export reads; every other output stays unread. */
export const WORKLOAD_IDENTITY_OUTPUT = "anthropic_workload_identity";

/**
 * Turn `tofu output -json anthropic_workload_identity` into the committed
 * inventory. Parsing through the same schema CDK8s uses means a renamed output
 * field or a malformed id fails here, at export, rather than at synthesis.
 */
export function workloadIdentityInventory(
  tofuOutputJson: string,
): LlmWorkloadIdentity {
  const anthropic: unknown = JSON.parse(tofuOutputJson);
  return LlmWorkloadIdentitySchema.parse({ anthropic });
}

export function serializeWorkloadIdentityInventory(
  inventory: LlmWorkloadIdentity,
): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}
