import { imessageIngressConfig } from "#config/imessage.ts";
import { prepareImessageChatCommand } from "#lib/imessage-chat.ts";
import type { ImessageCommand } from "#shared/agent/agent-chat-imessage.ts";

export async function prepareImessageCommand(rawCommand: ImessageCommand) {
  return prepareImessageChatCommand(
    rawCommand,
    "imessage",
    imessageIngressConfig,
  );
}
