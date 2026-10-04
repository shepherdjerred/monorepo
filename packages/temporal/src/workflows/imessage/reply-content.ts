import { workflowInfo } from "@temporalio/workflow";
import type { z } from "zod/v4";
import {
  AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  AgentChatTurnResultSchema,
} from "#shared/agent/agent-chat.ts";
import type { HttpAgentChatActivities } from "#shared/agent/agent-chat-http.ts";
import type { PreparedImessageCommandSchema } from "#shared/agent/agent-chat-imessage.ts";

export async function imessageReplyContent(
  prepared: z.infer<typeof PreparedImessageCommandSchema>,
  execution: HttpAgentChatActivities,
): Promise<string> {
  if (prepared.kind === "message") return prepared.content;
  try {
    const providerStartDeadline = new Date(
      workflowInfo().startTime.getTime() +
        AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
    ).toISOString();
    const result = AgentChatTurnResultSchema.parse(
      await execution.executeHttpAgentChatCommand({
        command: prepared.command,
        providerStartDeadline,
      }),
    );
    return result.finalText;
  } catch {
    return "The durable agent chat request failed. Check its Temporal execution; it will not automatically repeat provider effects.";
  }
}
