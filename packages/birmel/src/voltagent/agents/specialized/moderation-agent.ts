import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { moderationToolSet } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { createMemory } from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { sanitizeReplayHook } from "@shepherdjerred/birmel/voltagent/agents/hooks.ts";
import {
  buildSubAgentPrompt,
  type PersonaContext,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";

const MODERATION_PURPOSE = `This agent handles Discord moderation and administration.
    It can kick, ban, unban, and timeout members.
    It manages roles and permissions.
    It configures automod rules.
    It manages webhooks, invites, emojis, and stickers.
    Use this agent for moderation actions, role management, or server administration.`;

const MODERATION_RESPONSIBILITIES = `Kick, ban, unban, and timeout members. Create, edit, delete, and assign roles. Configure automod rules. Manage webhooks, invites, emojis, and stickers.`;

const MODERATION_TOOL_GUIDANCE = `- For destructive actions on a SPECIFIC named target (kick @user, ban @user), proceed without further confirmation if the requester appears authorized.
- For destructive actions on 2–10 specific items, list the resolved targets in your reply and ask for one-line confirmation before executing.
- Refuse bulk destructive ("ban all members") or mass-creation (">10 channels at once") requests with a one-line explanation.
- Use \`manage-moderation\` for kick/ban/timeout, \`manage-role\` for role lifecycle, \`manage-automod\` for automod rules, \`manage-webhook\` / \`manage-invite\` / \`manage-emoji\` for the rest.`;

export function createModerationAgent(persona: PersonaContext | null): Agent {
  const config = getConfig();
  return new Agent({
    name: "moderation-agent",
    purpose: MODERATION_PURPOSE,
    instructions: buildSubAgentPrompt({
      agentName: "moderation-agent",
      responsibilities: MODERATION_RESPONSIBILITIES,
      toolGuidance: MODERATION_TOOL_GUIDANCE,
      persona,
    }),
    model: openai(config.openai.model),
    tools: moderationToolSet,
    memory: createMemory(),
    hooks: {
      onPrepareMessages: sanitizeReplayHook,
    },
  });
}

export const moderationAgent = createModerationAgent(null);
