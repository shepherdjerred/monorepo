import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { editorToolSet } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { createMemory } from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { sanitizeReplayHook } from "@shepherdjerred/birmel/voltagent/agents/hooks.ts";
import {
  buildSubAgentPrompt,
  type PersonaContext,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";

const EDITOR_PURPOSE = `This agent handles file editing in allowed repositories.
    It can edit files in allowed repositories.
    It creates pull requests.
    It connects GitHub accounts.
    It lists available repos.
    It approves or rejects pending changes.
    Use this agent for code editing, PR creation, or repository management.`;

const EDITOR_RESPONSIBILITIES = `Edit files in the curated set of allowed repositories. Open pull requests on the user's behalf. Maintain GitHub OAuth connections. List allowed repos. Approve or reject pending changes proposed in earlier turns.`;

const EDITOR_TOOL_GUIDANCE = `- Always start with \`list-repos\` if you don't already know the target repo.
- Use \`get-session\` to fetch the user's existing GitHub OAuth session before edits; if missing, call \`connect-github\` to surface the OAuth URL.
- \`edit-repo\` makes the change but does NOT push — it stages the diff for approval. Tell the user what you changed and ask them to approve.
- \`approve-changes\` finalizes the diff and opens a PR.
- Reply tools are also available so you can format the diff/PR link nicely for the user after the work is done.`;

export function createEditorAgent(persona: PersonaContext | null): Agent {
  const config = getConfig();
  return new Agent({
    name: "editor-agent",
    purpose: EDITOR_PURPOSE,
    instructions: buildSubAgentPrompt({
      agentName: "editor-agent",
      responsibilities: EDITOR_RESPONSIBILITIES,
      toolGuidance: EDITOR_TOOL_GUIDANCE,
      persona,
    }),
    model: openai(config.openai.model),
    tools: editorToolSet,
    memory: createMemory(),
    hooks: {
      onPrepareMessages: sanitizeReplayHook,
    },
  });
}

export const editorAgent = createEditorAgent(null);
