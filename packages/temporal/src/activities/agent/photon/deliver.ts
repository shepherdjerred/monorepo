import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod/v4";
import { sendPhotonText } from "#lib/photon/client.ts";
import { photonDeliveryTotal } from "#observability/metrics.ts";
import {
  PhotonMessageSchema,
  type PhotonDelivery,
} from "#shared/agent/agent-chat-photon.ts";

const DeliverySchema = PhotonMessageSchema.pick({
  messageId: true,
  spaceId: true,
  senderId: true,
  linePhone: true,
}).extend({ content: z.string().max(500_000) });
export async function deliverPhotonResponse(rawInput: PhotonDelivery) {
  const input = DeliverySchema.parse(rawInput);
  try {
    // The response is already in Workflow history. An ambiguous send must not
    // repeat provider work or delivery; this Activity has one attempt.
    const messageId = await sendPhotonText(
      input.spaceId,
      input.linePhone,
      input.content,
    );
    photonDeliveryTotal.inc({ outcome: "completed" });
    return { messageId };
  } catch {
    photonDeliveryTotal.inc({ outcome: "failed" });
    // SDK errors can contain transport credentials or message bodies.
    throw ApplicationFailure.nonRetryable(
      "Photon delivery failed or is ambiguous; inspect the checkpointed response before manual recovery",
      "PhotonDeliveryFailed",
    );
  }
}
