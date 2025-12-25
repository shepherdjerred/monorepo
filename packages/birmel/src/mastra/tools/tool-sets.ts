/**
 * Specialized tool sets for different agent types.
 * This allows us to stay under the 128 tool limit per API call
 * while still having all functionality available.
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
import { voiceTools } from "./discord/voice.js";
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

/**
 * General Discord Agent - for everyday interactions (~63 tools)
 * Handles: messaging, channels, members, polls, threads, scheduling, memory, elections, birthdays
 */
export const generalToolSet = [
  ...guildTools,
  ...messageTools,
  ...channelTools,
  ...memberTools,
  ...pollTools,
  ...threadTools,
  ...activityTools,
  ...schedulingTools,
  ...memoryTools,
  ...sqliteTools,
  ...electionTools,
  ...birthdayTools,
];

/**
 * Admin/Moderation Agent - for server administration (~59 tools)
 * Handles: moderation, roles, automod, webhooks, invites, events, emojis
 */
export const adminToolSet = [
  ...moderationTools,
  ...roleTools,
  ...automodTools,
  ...webhookTools,
  ...inviteTools,
  ...eventTools,
  ...emojiTools,
  ...guildTools, // For getting guild info
  ...channelTools, // For context
  ...memberTools, // For context
];

/**
 * Music/Automation Agent - for entertainment and automation (~52 tools)
 * Handles: music playback, voice, automation tasks, external APIs
 */
export const musicAutomationToolSet = [
  ...allMusicTools,
  ...voiceTools,
  ...allAutomationTools,
  ...allExternalTools,
  ...messageTools, // To respond in channels
  ...channelTools, // To find channels
];

export type AgentType = "general" | "admin" | "music";

/**
 * Get the appropriate tool set for an agent type
 */
export function getToolSet(agentType: AgentType) {
  switch (agentType) {
    case "general":
      return generalToolSet;
    case "admin":
      return adminToolSet;
    case "music":
      return musicAutomationToolSet;
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
console.log(`[tool-sets] General: ${String(generalToolSet.length)} tools`);
console.log(`[tool-sets] Admin: ${String(adminToolSet.length)} tools`);
console.log(`[tool-sets] Music/Automation: ${String(musicAutomationToolSet.length)} tools`);
