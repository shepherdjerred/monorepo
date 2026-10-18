import { RequestTrmnlRepairSchema } from "@shepherdjerred/delivery/contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { DeployOptions } from "./common.ts";

export function validateTrmnlCommand(
  positionals: string[],
  options: DeployOptions,
) {
  if (positionals.length !== 2 || positionals[0] !== "repair")
    throw new Error("Use deploy trmnl repair <FAILED_DEPLOYMENT_ID>");
  if (!options.machine)
    throw new Error("TRMNL repair requires an admin --machine credential");
  RequestTrmnlRepairSchema.parse({
    requestId: options["request-id"] ?? "validation",
    expectedEnvironmentGeneration: Number(options["expected-generation"]),
    reason: options.reason,
  });
}
export async function runTrmnlCommand(
  client: DeliveryClient,
  positionals: string[],
  options: DeployOptions & { requestNotice?: (id: string) => void },
) {
  validateTrmnlCommand(positionals, options);
  const target = positionals[1];
  if (target === undefined)
    throw new Error("Explicit failed deployment required");
  const input = RequestTrmnlRepairSchema.parse({
    requestId: options["request-id"] ?? crypto.randomUUID(),
    expectedEnvironmentGeneration: Number(options["expected-generation"]),
    reason: options.reason,
  });
  options.requestNotice?.(input.requestId);
  return {
    result: await client.requestTrmnlRepair(target, input),
    exitCode: 0,
  };
}
