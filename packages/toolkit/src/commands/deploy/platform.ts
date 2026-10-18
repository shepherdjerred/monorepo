import {
  CreatePlatformDeploymentSchema,
  RequestControlPlaneUpgradeSchema,
  RequestPlatformRecoverySchema,
  ApprovePlatformRecoveryPlanSchema,
} from "@shepherdjerred/delivery/contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { DeployOptions } from "./common.ts";

export function validatePlatformCommand(
  positionals: string[],
  options: DeployOptions,
) {
  const [action] = positionals;
  if (
    ![
      "request",
      "control-plane",
      "recover",
      "recovery",
      "recovery-approve",
    ].includes(action ?? "") ||
    positionals.length !==
      (["request", "control-plane"].includes(action ?? "") ? 1 : 2)
  )
    throw new Error(
      "Invalid operands; use deploy platform request --file <PATH> or recovery commands",
    );
  if (
    ["request", "control-plane"].includes(action ?? "") &&
    options.file === undefined
  )
    throw new Error("Platform intent requires an explicit --file");
  if (["recover", "control-plane"].includes(action ?? "") && !options.machine)
    throw new Error(
      "Explicit infrastructure administration requires --machine",
    );
  if (action === "recover")
    RequestPlatformRecoverySchema.parse({
      requestId: options["request-id"] ?? "validation",
      expectedEnvironmentGeneration: Number(options["expected-generation"]),
      reason: options.reason,
    });
  if (action === "recovery-approve") {
    if (options.machine)
      throw new Error(
        "Recovery approval requires trusted human identity; omit --machine",
      );
    ApprovePlatformRecoveryPlanSchema.parse({
      planFingerprint: options["plan-fingerprint"],
      decision: options.decision,
      reason: options.reason,
    });
  }
}

export async function runPlatformCommand(
  client: DeliveryClient,
  positionals: string[],
  options: DeployOptions & { requestNotice?: (id: string) => void },
) {
  const [action, target] = positionals;
  if (action === "recovery") {
    if (target === undefined)
      throw new Error("Explicit recovery intent required");
    return { result: await client.platformRecovery(target), exitCode: 0 };
  }
  if (action === "recovery-approve") {
    if (target === undefined)
      throw new Error("Explicit recovery intent required");
    const input = ApprovePlatformRecoveryPlanSchema.parse({
      planFingerprint: options["plan-fingerprint"],
      decision: options.decision,
      reason: options.reason,
    });
    return {
      result: await client.approvePlatformRecoveryPlan(target, input),
      exitCode: 0,
    };
  }
  if (action === "recover") {
    if (target === undefined)
      throw new Error("Explicit failed infrastructure deployment required");
    const input = RequestPlatformRecoverySchema.parse({
      requestId: options["request-id"] ?? crypto.randomUUID(),
      expectedEnvironmentGeneration: Number(options["expected-generation"]),
      reason: options.reason,
    });
    options.requestNotice?.(input.requestId);
    return {
      result: await client.requestPlatformRecovery(target, input),
      exitCode: 0,
    };
  }
  if (options.file === undefined) throw new Error("--file is required");
  if (action === "control-plane") {
    const input = RequestControlPlaneUpgradeSchema.parse(
      await Bun.file(options.file).json(),
    );
    options.requestNotice?.(input.requestId);
    return {
      result: await client.requestControlPlaneUpgrade(
        "delivery-control-plane/prod",
        input,
      ),
      exitCode: 0,
    };
  }
  const input = CreatePlatformDeploymentSchema.parse(
    await Bun.file(options.file).json(),
  );
  options.requestNotice?.(input.requestId);
  return { result: await client.createPlatformDeployment(input), exitCode: 0 };
}
