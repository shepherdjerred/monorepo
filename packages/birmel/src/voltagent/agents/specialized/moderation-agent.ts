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

const MODERATION_RESPONSIBILITIES = `Kick, ban, unban, and timeout members. Create, edit, delete, and reorder roles. Grant or revoke roles on individual members. Change member nicknames. Configure automod rules. Manage webhooks, invites, emojis, and stickers.`;

const MODERATION_TOOL_GUIDANCE = `- Kick/ban/timeout: use \`manage-moderation\`.
- **Grant or revoke a role to a specific member**: use \`manage-member\` with action \`add-role\` or \`remove-role\` (memberId + roleId required). NEVER use \`manage-role\` for this — that tool only edits role definitions.
- **Change a member's nickname**: use \`manage-member\` with action \`modify\` and the \`nickname\` field. You DO have this tool — never tell the user otherwise.
- **Edit a role's properties** (rename, recolor, reorder): use \`manage-role\` with action \`modify\` or \`reorder\`. This does NOT assign the role to anyone.
- Automod / webhooks / invites / emojis: \`manage-automod\` / \`manage-webhook\` / \`manage-invite\` / \`manage-emoji\`.
- For destructive actions on a SPECIFIC named target (kick @user, ban @user), proceed without further confirmation if the requester appears authorized.
- For destructive actions on 2–10 specific items, list the resolved targets in your reply and ask for one-line confirmation before executing.
- Refuse bulk destructive ("ban all members") or mass-creation (">10 channels at once") requests with a one-line explanation.`;

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
