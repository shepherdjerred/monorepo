import { imessageIngressConfig } from "#config/imessage.ts";
import { prepareImessageChatCommand } from "#lib/imessage-chat.ts";
import { ImessageCommandSchema } from "#shared/agent/agent-chat-imessage.ts";
import {
  PhotonCommandSchema,
  type PhotonCommand,
} from "#shared/agent/agent-chat-photon.ts";

export async function preparePhotonCommand(rawCommand: PhotonCommand) {
  const command = PhotonCommandSchema.parse(rawCommand);
  if (command.outOfOrder)
    return {
      kind: "message" as const,
      content:
        "This message arrived after a newer message in this conversation. Please resend it so I can apply it in order.",
    };
  const {
    messageId,
    conversationId,
    submittedAt,
    sourceSequence,
    sourceEpoch,
    action,
  } = command;
  return await prepareImessageChatCommand(
    ImessageCommandSchema.parse({
      messageId,
      conversationId,
      submittedAt,
      sourceSequence,
      sourceEpoch,
      action,
    }),
    "photon",
    imessageIngressConfig,
  );
}
