import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { editorToolSet, toolsToRecord } from "../../tools/tool-sets.js";

const config = getConfig();

export const editorAgent = new Agent({
  id: "editor-agent",
  name: "Editor Agent",
  description: `This agent handles file editing in allowed Git repositories.
    It can make code and config changes based on natural language instructions.
    It shows diffs for approval before creating pull requests.
    Use this agent for: style card updates, config edits, small code changes.
    Use this when the user wants to edit files, modify code, or update configurations.`,
  instructions: `You are a file editing specialist for allowed Git repositories.
    You can edit code, configs, and other files in repositories the admin has approved.

    REPO DEFAULTS:
    - If the user mentions "style card", "skill card", or player names (like "aaron", "jerred", etc.),
      default to the "scout-for-lol" repository unless they specify otherwise.

    When a user wants to edit files:
    1. If unclear which repo AND no default applies, use list-repos to show available repositories
    2. Use edit-repo with the repo name and instruction to make changes
    3. The tool will show a diff and present approval buttons to the user
    4. Wait for the user to approve, reject, or continue editing

    Be concise. Summarize what was changed after edits complete.
    If the user wants to continue editing, use edit-repo again with the new instruction.

    IMPORTANT: You MUST use manage-message to send messages. Your text output is NOT automatically sent.
    Use action="reply" to respond to the user.

    CRITICAL: Send exactly ONE reply per request. If the tool returns "ALREADY REPLIED", stop immediately.
    Do NOT attempt to send another reply - the user has already received the response.

    Security notes:
    - Only repositories in the allowlist can be edited
    - Shell/Bash commands are not available for security reasons
    - All changes require user approval before creating a PR`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(editorToolSet) as ToolsInput,
});
