import { Context } from "@temporalio/activity";
import {
  IsoInstantSchema,
  WorkflowRunIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutCustomOperationInputSchema,
  scoutCustomOperationWorkflowId,
  type ScoutCustomOperationInput,
  type ScoutCustomOperationResult,
} from "@scout-for-lol/temporal";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  getWorkflowStart,
  recordWorkflowStartAccepted,
} from "#src/database/durable/workflow-start-repository.ts";
import { withScoutEffectFence } from "#src/temporal/effect-fence.ts";
import {
  CustomOperationPayloadSchema,
  CustomOperationProgressSchema,
  type CustomOperationPayload,
} from "#src/customs/operations/contracts.ts";
import {
  persistCustomProgress,
  provisionCustomTeams,
  moveCustomParticipants,
  deleteCustomTeams,
  type CustomVoicePort,
  type CustomOperationExecution,
} from "#src/customs/operations/execution-steps.ts";
import { completeCustomOperation } from "#src/customs/operations/execution-completion.ts";

/** Every checkpoint commits independently of the long-lived exclusion fence. */
export async function executeCustomOperationWithPort(
  db: ExtendedPrismaClient,
  operationId: string,
  makePort: (payload: CustomOperationPayload) => Promise<CustomVoicePort>,
  cancellation?: AbortSignal,
): Promise<ScoutCustomOperationResult> {
  return await withScoutEffectFence(
    `custom-operation:${operationId}`,
    async (fence) => {
      const operation = await db.customNightOperation.findUniqueOrThrow({
        where: { id: operationId },
      });
      const result = (
        state: "completed" | "held",
      ): ScoutCustomOperationResult => ({ nightId: operation.nightId, state });
      if (operation.state === "completed") return result("completed");
      if (operation.state === "held") return result("held");
      if (!["queued", "running"].includes(operation.state))
        throw new Error("Custom operation is terminal");
      const payload = CustomOperationPayloadSchema.parse(
        JSON.parse(operation.payload),
      );
      if (
        payload.action !== operation.action ||
        payload.snapshot.id !== operation.nightId
      )
        throw new Error("Custom operation columns disagree with its payload");
      const progress = CustomOperationProgressSchema.parse(
        JSON.parse(operation.progress),
      );
      const context: CustomOperationExecution = {
        db,
        operationId,
        payload,
        progress,
        fence,
        cancellation,
      };
      if (progress.creating !== null) {
        progress.step = `Confirm whether Team ${progress.creating} was created before resuming`;
        await persistCustomProgress(context, "held");
        return result("held");
      }
      const port = await makePort(payload);
      cancellation?.throwIfAborted();
      port.assertReady();
      if (
        payload.action === "arrange" &&
        (await provisionCustomTeams(context, port)) === "held"
      )
        return result("held");
      await moveCustomParticipants(context, port);
      await deleteCustomTeams(context, port);
      await completeCustomOperation(context);
      return result("completed");
    },
    { database: db },
  );
}

export async function executeDurableCustomOperation(
  rawInput: ScoutCustomOperationInput,
): Promise<ScoutCustomOperationResult> {
  const input = ScoutCustomOperationInputSchema.parse(rawInput);
  const execution = Context.current().info.workflowExecution;
  if (execution === undefined)
    throw new Error(
      "Customs operations must execute inside a Workflow Activity",
    );
  if (
    execution.workflowId !==
    scoutCustomOperationWorkflowId(input.stage, input.operationId)
  )
    throw new Error("Custom operation Workflow ID disagrees with its request");
  const request = await getWorkflowStart(prisma, {
    requestedWorkflowId: execution.workflowId,
  });
  if (
    request === null ||
    !Bun.deepEquals(request.inputPayload.data, input, true)
  )
    throw new Error("Custom operation has no matching committed start request");
  if (request.acceptance === null)
    await recordWorkflowStartAccepted(prisma, {
      requestId: request.requestId,
      acceptedAt: IsoInstantSchema.parse(new Date().toISOString()),
      runId: WorkflowRunIdSchema.parse(execution.runId),
    });
  const { customVoicePort } =
    await import("#src/customs/operations/voice-port.ts");
  return await executeCustomOperationWithPort(
    prisma,
    input.operationId,
    async (payload) => await customVoicePort(input.operationId, payload),
    Context.current().cancellationSignal,
  );
}
