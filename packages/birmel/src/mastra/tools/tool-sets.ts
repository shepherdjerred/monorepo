/**
 * Specialized tool sets for different agent types.
 * Split into 5 focused agents to stay well under the 128 tool limit.
 */

import { guildTools } from "./discord/guild.js";
import { messageTools } from "./discord/messages.js";
import { moderationTools } from "./discord/moderation.js";
import { channelTools } from "./discord/channels.js";
import { roleTools } from "./discord/roles.js";
import { memberTools } from "./discord/members.js";
import { emojiTools } from "./discord/emojis.js";
import { eventTools } from "./discord/events.js";
import { webhookTools } from "./discord/webhooks.js";
import { inviteTools } from "./discord/invites.js";
import { automodTools } from "./discord/automod.js";
import { pollTools } from "./discord/polls.js";
import { threadTools } from "./discord/threads.js";
import { activityTools } from "./discord/activity.js";
import { schedulingTools } from "./discord/scheduling.js";
import { allMusicTools } from "./music/index.js";
import { allAutomationTools } from "./automation/index.js";
import { allExternalTools } from "./external/index.js";
import { memoryTools } from "./memory/index.js";
import { sqliteTools } from "./database/sqlite-query.js";
import { electionTools } from "./elections/elections.js";
import { birthdayTools } from "./birthdays/index.js";
import { editorTools } from "./editor/index.js";

/**
 * Messaging Agent - handles messages, threads, polls, and scheduling
 */
export const messagingToolSet = [
  ...messageTools,
  ...threadTools,
  ...pollTools,
  ...activityTools,
  ...schedulingTools,
  ...memoryTools,
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
export const musicToolSet = [
  ...allMusicTools,
];

/**
 * Automation Agent - handles automation, external APIs, events, elections, birthdays
 */
export const automationToolSet = [
  ...allAutomationTools,
  ...allExternalTools,
  ...eventTools,
  ...electionTools,
  ...birthdayTools,
];

/**
 * Editor Agent - handles file editing in allowed repositories
 */
export const editorToolSet = [
  ...editorTools,
  ...messageTools, // Needs message tools for replies
];

export type AgentType = "messaging" | "server" | "moderation" | "music" | "automation" | "editor";

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
export function toolsToRecord(tools: { id: string }[]) {
  return Object.fromEntries(
    tools.map((tool) => [tool.id, tool]),
  ) as Record<string, unknown>;
}

// Log tool counts on module load (for debugging)
console.log(`[tool-sets] Messaging: ${String(messagingToolSet.length)} tools`);
console.log(`[tool-sets] Server: ${String(serverToolSet.length)} tools`);
console.log(`[tool-sets] Moderation: ${String(moderationToolSet.length)} tools`);
console.log(`[tool-sets] Music: ${String(musicToolSet.length)} tools`);
console.log(`[tool-sets] Automation: ${String(automationToolSet.length)} tools`);
console.log(`[tool-sets] Editor: ${String(editorToolSet.length)} tools`);
