import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { serverToolSet } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { createMemory } from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { sanitizeReplayHook } from "@shepherdjerred/birmel/voltagent/agents/hooks.ts";
import {
  buildSubAgentPrompt,
  type PersonaContext,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";

const SERVER_PURPOSE = `This agent handles Discord server/guild information.
    It gets server/guild information.
    It lists, creates, and modifies channels.
    It searches and manages members.
    It queries the database.
    Use this agent for server info, channel management, or member lookups.`;

const SERVER_RESPONSIBILITIES = `Look up guild metadata, channel listings, member rosters and roles. Create, modify, or archive channels. Run read-only SQL queries against the local SQLite database to answer questions about persisted state.`;

const SERVER_TOOL_GUIDANCE = `- Use \`manage-guild\` for guild metadata.
- Use \`manage-channel\` to list/create/modify channels — prefer "list" first when answering "what channels are there".
- Use \`manage-member\` to look up and search members.
- Use \`sqlite-query\` for analytical questions over the local DB ("who has the most karma", "when was X last seen"). Read-only — no INSERT/UPDATE/DELETE.
- Always answer with the data you fetched, not from prior knowledge.`;

export function createServerAgent(persona: PersonaContext | null): Agent {
  const config = getConfig();
  return new Agent({
    name: "server-agent",
    purpose: SERVER_PURPOSE,
    instructions: buildSubAgentPrompt({
      agentName: "server-agent",
      responsibilities: SERVER_RESPONSIBILITIES,
      toolGuidance: SERVER_TOOL_GUIDANCE,
      persona,
    }),
    model: openai(config.openai.model),
    tools: serverToolSet,
    memory: createMemory(),
    hooks: {
      onPrepareMessages: sanitizeReplayHook,
    },
  });
}

export const serverAgent = createServerAgent(null);
