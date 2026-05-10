import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { automationToolSet } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { createMemory } from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { sanitizeReplayHook } from "@shepherdjerred/birmel/voltagent/agents/hooks.ts";
import {
  buildSubAgentPrompt,
  type PersonaContext,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";

const AUTOMATION_PURPOSE = `This agent handles automation, external APIs, and scheduling.
    It can set reminders and timers.
    It runs shell commands.
    It does browser automation.
    It fetches weather and news.
    It manages elections and birthdays.
    It schedules events.
    Use this agent for automation tasks, external integrations, or scheduling.`;

const AUTOMATION_RESPONSIBILITIES = `Set reminders/timers. Run sandboxed shell commands. Drive browser automation. Fetch weather, news, and other external data. Manage elections and birthdays. Schedule events.`;

const AUTOMATION_TOOL_GUIDANCE = `- For "remind me in N minutes" or "in N hours", use \`manage-task\` with a relative trigger.
- For weather, news, or generic web fetches, use \`external-service\` — pick the right service slug rather than free-form scraping.
- \`execute-shell-command\` is sandboxed; surface non-zero exit codes verbatim in your reply.
- \`browser-automation\` is for tasks requiring real DOM interaction; for simple fetches use external-service or web fetch instead.
- For birthdays use \`manage-birthday\`; for elections use \`manage-election\` and friends.`;

export function createAutomationAgent(persona: PersonaContext | null): Agent {
  const config = getConfig();
  return new Agent({
    name: "automation-agent",
    purpose: AUTOMATION_PURPOSE,
    instructions: buildSubAgentPrompt({
      agentName: "automation-agent",
      responsibilities: AUTOMATION_RESPONSIBILITIES,
      toolGuidance: AUTOMATION_TOOL_GUIDANCE,
      persona,
    }),
    model: openai(config.openai.model),
    tools: automationToolSet,
    memory: createMemory(),
    hooks: {
      onPrepareMessages: sanitizeReplayHook,
    },
  });
}

export const automationAgent = createAutomationAgent(null);
