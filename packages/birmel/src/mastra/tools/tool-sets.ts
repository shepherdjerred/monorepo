/**
 * Specialized tool sets for different agent types.
 * Split into 5 focused agents to stay well under the 128 tool limit.
 */

import { guildTools } from "./discord/guild.ts";
import { messageTools } from "./discord/messages.ts";
import { moderationTools } from "./discord/moderation.ts";
import { channelTools } from "./discord/channels.ts";
import { roleTools } from "./discord/roles.ts";
import { memberTools } from "./discord/members.ts";
import { emojiTools } from "./discord/emojis.ts";
import { eventTools } from "./discord/events.ts";
import { webhookTools } from "./discord/webhooks.ts";
import { inviteTools } from "./discord/invites.ts";
import { automodTools } from "./discord/automod.ts";
import { pollTools } from "./discord/polls.ts";
import { threadTools } from "./discord/threads.ts";
import { activityTools } from "./discord/activity.ts";
import { schedulingTools } from "./discord/scheduling.ts";
import { playbackTools } from "./music/playback.ts";
import { queueTools } from "./music/queue.ts";
import { executeShellCommandTool } from "./automation/shell.ts";
import { manageTaskTool } from "./automation/timers.ts";
import { browserAutomationTool } from "./automation/browser.ts";
import { externalServiceTool } from "./external/web.ts";
import { manageMemoryTool } from "./memory/index.ts";
import { sqliteTools } from "./database/sqlite-query.ts";
import { electionTools } from "./elections/elections.ts";
import { manageBirthdayTool } from "./birthdays/index.ts";
import { editRepoTool } from "./editor/edit-repo.ts";
import { listReposTool } from "./editor/list-repos.ts";
import { getSessionTool } from "./editor/get-session.ts";
import { approveChangesTool } from "./editor/approve-changes.ts";
import { connectGitHubTool } from "./editor/connect-github.ts";

/**
 * Messaging Agent - handles messages, threads, polls, and scheduling
 */
export const messagingToolSet = [
  ...messageTools,
  ...threadTools,
  ...pollTools,
  ...activityTools,
  ...schedulingTools,
  manageMemoryTool,
];

/**
 * Server Agent - handles guild info, channels, and members
 */
export const serverToolSet = [
  ...guildTools,
  ...channelTools,
  ...memberTools,
  ...sqliteTools,
];

/**
 * Moderation Agent - handles moderation, roles, automod, webhooks
 */
export const moderationToolSet = [
  ...moderationTools,
  ...roleTools,
  ...automodTools,
  ...webhookTools,
  ...inviteTools,
  ...emojiTools,
];

/**
 * Music Agent - handles music playback
 */
export const musicToolSet = [...playbackTools, ...queueTools];

/**
 * Automation Agent - handles automation, external APIs, events, elections, birthdays
 */
export const automationToolSet = [
  executeShellCommandTool,
  manageTaskTool,
  browserAutomationTool,
  externalServiceTool,
  ...eventTools,
  ...electionTools,
  manageBirthdayTool,
];

/**
 * Editor Agent - handles file editing in allowed repositories
 */
export const editorToolSet = [
  editRepoTool,
  listReposTool,
  getSessionTool,
  approveChangesTool,
  connectGitHubTool,
  ...messageTools, // Needs message tools for replies
];

export type AgentType =
  | "messaging"
  | "server"
  | "moderation"
  | "music"
  | "automation"
  | "editor";

/**
 * Get the appropriate tool set for an agent type
 */
export function getToolSet(agentType: AgentType) {
  switch (agentType) {
    case "messaging":
      return messagingToolSet;
    case "server":
      return serverToolSet;
    case "moderation":
      return moderationToolSet;
    case "music":
      return musicToolSet;
    case "automation":
      return automationToolSet;
    case "editor":
      return editorToolSet;
  }
}

/**
 * Get description for each agent type (used by Agent Networks for routing)
 */
export function getAgentDescription(agentType: AgentType): string {
  switch (agentType) {
    case "messaging":
      return "Send, edit, delete, pin messages. Create polls and threads. Schedule messages. Track activity. Store memories.";
    case "server":
      return "Get server/guild information. List, create, modify channels. Search and manage members. Query database.";
    case "moderation":
      return "Kick, ban, timeout, warn members. Manage roles and permissions. Configure automod rules. Manage webhooks and invites. Add emojis/stickers.";
    case "music":
      return "Play, pause, skip, stop music. Manage queue. Control volume and loop mode.";
    case "automation":
      return "Set reminders and timers. Run shell commands. Browser automation. Fetch weather/news. Manage elections and birthdays. Schedule events.";
    case "editor":
      return "Edit files in allowed repositories. Create pull requests. Connect GitHub account. List available repos. Approve or reject pending changes.";
  }
}

/**
 * Convert a tool array to a record for Mastra Agent.
 * Uses unknown type to avoid strict type checking issues with different tool schemas.
 */
export function toolsToRecord(
  tools: { id: string }[],
): Record<string, unknown> {
  const entries: [string, unknown][] = tools.map((tool) => [tool.id, tool]);
  return Object.fromEntries(entries);
}

// Log tool counts on module load (for debugging)
console.log(`[tool-sets] Messaging: ${String(messagingToolSet.length)} tools`);
console.log(`[tool-sets] Server: ${String(serverToolSet.length)} tools`);
console.log(
  `[tool-sets] Moderation: ${String(moderationToolSet.length)} tools`,
);
console.log(`[tool-sets] Music: ${String(musicToolSet.length)} tools`);
console.log(
  `[tool-sets] Automation: ${String(automationToolSet.length)} tools`,
);
console.log(`[tool-sets] Editor: ${String(editorToolSet.length)} tools`);
