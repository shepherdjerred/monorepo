import type { Principal } from "#shared/contract.ts";
import { environment, type Transaction } from "./delivery-data.ts";
import { lock, request, replayDeployment } from "./delivery-records.ts";

/** Request identity and environment ownership are read under one transaction. */
export async function beginDeploymentRequest(
  tx: Transaction,
  actor: Principal,
  options: { requestId: string; input: unknown; environmentId: string },
) {
  const stored = await request(tx, actor, {
    requestId: options.requestId,
    input: options.input,
    resultType: "deployment",
  });
  if (stored !== null)
    return {
      kind: "replayed" as const,
      deployment: await replayDeployment(tx, stored.resultId),
    };
  await lock(tx, `environment:${options.environmentId}`);
  return {
    kind: "new" as const,
    environment: await environment(tx, options.environmentId),
  };
}
