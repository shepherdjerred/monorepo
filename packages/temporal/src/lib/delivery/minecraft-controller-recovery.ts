import type {
  DeploymentDetail,
  MinecraftRecoveryIntent,
} from "@shepherdjerred/delivery/contract";
import type {
  MinecraftControllerProcess,
  MinecraftControllerInput,
} from "./minecraft-controller-process.ts";
import { minecraftRuntimeImage } from "./minecraft.ts";

type RecoveryDetail = {
  intent: MinecraftRecoveryIntent;
  deployment: DeploymentDetail;
};
type Options = {
  loadRecovery: (intentId: string) => Promise<RecoveryDetail>;
  process: Pick<MinecraftControllerProcess, "prepare" | "run">;
  longRequest?: (request: Request) => void;
};
async function requireRecovery(
  options: Options,
  input: MinecraftControllerInput,
  recoveryId: string,
  receiptRequired: boolean,
) {
  const context = await options.loadRecovery(recoveryId);
  const current = context.deployment;
  if (
    context.intent.status !== "pending" ||
    context.intent.deploymentId !== input.deploymentId ||
    !current.deployment.recoveryRequired ||
    !current.deployment.cancelRequested ||
    !["failed", "canceled"].includes(current.deployment.status) ||
    current.environment.activeDeploymentId !== input.deploymentId ||
    current.environment.generation !==
      context.intent.expectedEnvironmentGeneration ||
    current.stages.some((stage) => stage.key === "reconcile") ||
    minecraftRuntimeImage(current) !== input.candidateImage
  )
    throw new Error(
      "Recovery lost the same admin-quarantined pre-selection PG owner",
    );
  if (receiptRequired && context.intent.controllerReceipt === null)
    throw new Error(
      "Recovery native controller must be recorded before cleanup",
    );
  return context;
}

export async function handleMinecraftRecovery(
  options: Options,
  input: MinecraftControllerInput,
  operation: {
    command: "prepare-recovery" | "recover" | "report";
    recoveryId: string | undefined;
    active: Set<string>;
    request: Request;
  },
): Promise<Response> {
  const recoveryId = operation.recoveryId;
  if (recoveryId === undefined)
    throw new Error("Independent recovery requires an explicit admin intent");
  await requireRecovery(options, input, recoveryId, false);
  if (operation.active.has(input.requestId))
    return Response.json(
      { error: "Original request remains active" },
      { status: 409 },
    );
  operation.active.add(input.requestId);
  try {
    if (operation.command === "prepare-recovery")
      return Response.json(await options.process.prepare(input, true));
    const context = await requireRecovery(options, input, recoveryId, true);
    // A read-only report never reconstructs metadata or the original source journal.
    if (operation.command === "recover") {
      const current = await options.process.prepare(input, true);
      if (
        JSON.stringify(current) !==
        JSON.stringify(context.intent.controllerReceipt)
      )
        throw new Error(
          "Recovery native controller incarnation changed after PG persistence",
        );
    }
    options.longRequest?.(operation.request);
    const result = await options.process.run(input, operation.command);
    await requireRecovery(options, input, recoveryId, true);
    return Response.json(result);
  } finally {
    operation.active.delete(input.requestId);
  }
}
