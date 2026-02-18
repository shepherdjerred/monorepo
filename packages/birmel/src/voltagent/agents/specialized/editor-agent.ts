import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.js";
import { editorToolSet } from "@shepherdjerred/birmel/mastra/tools/tool-sets.js";

const config = getConfig();

export const editorAgent = new Agent({
  name: "editor-agent",
  purpose: `This agent handles file editing in allowed repositories.
    It can edit files in allowed repositories.
    It creates pull requests.
    It connects GitHub accounts.
    It lists available repos.
    It approves or rejects pending changes.
    Use this agent for code editing, PR creation, or repository management.`,
  instructions: `You are a code editor specialist for Discord.
    Handle file editing, PR creation, and repository management.
    Always verify changes before committing.
    Be careful with code modifications.`,
  model: openai(config.openai.model),
  tools: editorToolSet,
});
