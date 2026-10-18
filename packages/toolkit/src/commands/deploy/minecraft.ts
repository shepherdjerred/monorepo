import { RequestMinecraftRecoverySchema } from "@shepherdjerred/delivery/contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { DeployOptions } from "./common.ts";

export function validateMinecraftCommand(
  positionals: string[],
  options: DeployOptions,
) {
  const [action] = positionals;
  if (
    positionals.length !== 2 ||
    !["recover", "recovery"].includes(action ?? "")
  )
    throw new Error(
      "Use deploy minecraft recover <DEPLOYMENT_ID> or recovery <INTENT_ID>",
    );
  if (action === "recover") {
    if (!options.machine)
      throw new Error(
        "Minecraft recovery requires an admin --machine credential",
      );
    if (options["expected-generation"] === undefined)
      throw new Error(
        "Minecraft recovery requires --expected-generation from the reviewed environment",
      );
    RequestMinecraftRecoverySchema.parse({
      requestId: options["request-id"] ?? "validation",
      expectedEnvironmentGeneration: Number(options["expected-generation"]),
      reason: options.reason,
    });
  }
}
export async function runMinecraftCommand(
  client: DeliveryClient,
  positionals: string[],
  options: DeployOptions & { requestNotice?: (id: string) => void },
) {
  const [action, target] = positionals;
  if (target === undefined)
    throw new Error(
      "Explicit Minecraft deployment or recovery intent is required",
    );
  if (action === "recovery")
    return { result: await client.minecraftRecovery(target), exitCode: 0 };
  const input = RequestMinecraftRecoverySchema.parse({
    requestId: options["request-id"] ?? crypto.randomUUID(),
    expectedEnvironmentGeneration: Number(options["expected-generation"]),
    reason: options.reason,
  });
  options.requestNotice?.(input.requestId);
  return {
    result: await client.requestMinecraftRecovery(target, input),
    exitCode: 0,
  };
}
