import { RequestContentRecoverySchema } from "@shepherdjerred/delivery/contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { DeployOptions } from "./common.ts";

export function validateContentRecovery(
  domain: "sites" | "forum",
  positionals: string[],
  options: DeployOptions,
) {
  const [action] = positionals;
  if (
    positionals.length !== 2 ||
    !["recover", "recovery"].includes(action ?? "")
  )
    throw new Error(
      `Use deploy ${domain} recover <DEPLOYMENT_ID> or recovery <INTENT_ID>`,
    );
  if (action === "recovery") return;
  if (!options.machine)
    throw new Error("Content recovery requires an admin --machine credential");
  if (options["expected-generation"] === undefined)
    throw new Error(
      "Content recovery requires --expected-generation from the held environment",
    );
  RequestContentRecoverySchema.parse({
    requestId: options["request-id"] ?? "validation",
    expectedEnvironmentGeneration: Number(options["expected-generation"]),
    reason: options.reason,
  });
}

export async function runContentRecovery(
  client: DeliveryClient,
  positionals: string[],
  options: DeployOptions & { requestNotice?: (id: string) => void },
) {
  const [action, target] = positionals;
  if (target === undefined)
    throw new Error(
      "Explicit deployment or content recovery intent is required",
    );
  if (action === "recovery")
    return { result: await client.contentRecovery(target), exitCode: 0 };
  const input = RequestContentRecoverySchema.parse({
    requestId: options["request-id"] ?? crypto.randomUUID(),
    expectedEnvironmentGeneration: Number(options["expected-generation"]),
    reason: options.reason,
  });
  options.requestNotice?.(input.requestId);
  return {
    result: await client.requestContentRecovery(target, input),
    exitCode: 0,
  };
}
