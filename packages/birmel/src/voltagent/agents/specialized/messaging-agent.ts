import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { messagingToolSet } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { createMemory } from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { sanitizeReplayHook } from "@shepherdjerred/birmel/voltagent/agents/hooks.ts";
import {
  buildSubAgentPrompt,
  type PersonaContext,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";

const MESSAGING_PURPOSE = `This agent handles Discord messaging operations.
    It can send, edit, delete, and pin messages.
    It creates and manages threads and polls.
    It schedules messages for later delivery.
    It tracks user activity and stores memories.
    Use this agent for any messaging, thread, poll, or memory-related task.`;

const MESSAGING_RESPONSIBILITIES = `Send, edit, delete, pin, and unpin Discord messages. Create threads and polls. Add and remove reactions. Schedule messages for later delivery. Send DMs. Track member activity. Store and retrieve memories (server-scope rules and owner-scope preferences) via the manage-memory tool.`;

const MESSAGING_TOOL_GUIDANCE = `- Use \`manage-message\` for all message operations: action="send" for other channels, "edit"/"delete"/"pin"/"unpin", "add-reaction"/"remove-reaction", "send-dm", "bulk-delete", "get".
- Do NOT call \`manage-message\` with action="reply"; the supervisor wires reply context automatically. Your final text output IS the reply.
- For memory: \`manage-memory\` with action="get"/"append"/"update"/"remove" and scope="server" or scope="owner". Always pick a scope.
- For threads/polls/scheduling, use the dedicated \`manage-thread\` / \`manage-poll\` / \`manage-schedule\` tools.
- After completing the work, write a short final message to the user describing what you did. Don't list every API call.`;

export function createMessagingAgent(persona: PersonaContext | null): Agent {
  const config = getConfig();
  return new Agent({
    name: "messaging-agent",
    purpose: MESSAGING_PURPOSE,
    instructions: buildSubAgentPrompt({
      agentName: "messaging-agent",
      responsibilities: MESSAGING_RESPONSIBILITIES,
      toolGuidance: MESSAGING_TOOL_GUIDANCE,
      persona,
    }),
    model: openai(config.openai.model),
    tools: messagingToolSet,
    memory: createMemory(),
    hooks: {
      onPrepareMessages: sanitizeReplayHook,
    },
  });
}

// Default no-persona instance used by the static `routingAgent` export.
export const messagingAgent = createMessagingAgent(null);
