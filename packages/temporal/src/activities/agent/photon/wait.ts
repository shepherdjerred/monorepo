import { ApplicationFailure } from "@temporalio/common";
import { WorkflowFailedError } from "@temporalio/client";
import { Context } from "@temporalio/activity";
import { createTemporalClient } from "#client";
import {
  photonCommandInputQuery,
  PhotonCommandSchema,
  type PhotonMessage,
} from "#shared/agent/agent-chat-photon.ts";

export async function waitForPhotonCommand(
  workflowId: string,
  message: PhotonMessage,
): Promise<void> {
  const context = Context.current();
  const heartbeat = () => {
    context.heartbeat({ phase: "join-photon-command", workflowId });
  };
  heartbeat();
  const timer = setInterval(heartbeat, 20_000);
  try {
    const temporal = await createTemporalClient();
    await temporal.withAbortSignal(context.cancellationSignal, async () => {
      const handle = temporal.workflow.getHandle(workflowId);
      const input = PhotonCommandSchema.parse(
        await handle.query(photonCommandInputQuery),
      );
      if (input.fingerprint !== message.fingerprint)
        throw ApplicationFailure.nonRetryable(
          "Photon message ID reused with different content",
          "PhotonMessageConflict",
        );
      try {
        await handle.result();
      } catch (error: unknown) {
        if (!(error instanceof WorkflowFailedError)) throw error;
        console.warn(
          JSON.stringify({
            component: "photon",
            msg: "Existing Photon command settled with a failure",
            workflowId,
          }),
        );
      }
    });
  } finally {
    clearInterval(timer);
  }
}
