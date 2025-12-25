/**
 * Simple keyword-based classifier to route messages to specialized agents.
 * This keeps us under the 128 tool limit by only loading relevant tools.
 */

import type { AgentType } from "../tools/tool-sets.js";

// Keywords that suggest music/automation intent
const MUSIC_KEYWORDS = [
  "play",
  "pause",
  "stop",
  "skip",
  "queue",
  "song",
  "music",
  "volume",
  "shuffle",
  "loop",
  "nowplaying",
  "now playing",
  "what's playing",
  "whats playing",
  "playlist",
  "track",
  "audio",
  "spotify",
  "youtube",
  "soundcloud",
];

const AUTOMATION_KEYWORDS = [
  "remind",
  "reminder",
  "schedule",
  "timer",
  "alarm",
  "later",
  "tomorrow",
  "in an hour",
  "in a minute",
  "run command",
  "execute",
  "shell",
  "script",
  "browser",
  "screenshot",
  "navigate",
  "scrape",
  "fetch",
  "weather",
  "news",
  "lol",
  "league",
];

const VOICE_KEYWORDS = [
  "join voice",
  "leave voice",
  "voice channel",
  "come to",
  "join us",
  "join me",
  "disconnect",
];

// Keywords that suggest admin/moderation intent
const ADMIN_KEYWORDS = [
  "kick",
  "ban",
  "unban",
  "mute",
  "unmute",
  "timeout",
  "moderate",
  "moderation",
  "role",
  "roles",
  "assign role",
  "remove role",
  "create role",
  "delete role",
  "permissions",
  "automod",
  "webhook",
  "invite",
  "invites",
  "event",
  "schedule event",
  "emoji",
  "emojis",
  "sticker",
  "stickers",
  "prune",
  "audit",
  "warn",
  "warning",
];

/**
 * Classify a message to determine which agent type should handle it.
 * Returns the most appropriate agent type based on keyword matching.
 */
export function classifyMessage(content: string): AgentType {
  const lowerContent = content.toLowerCase();

  // Check for music/voice/automation keywords first (more specific)
  const hasMusicKeyword = MUSIC_KEYWORDS.some((kw) =>
    lowerContent.includes(kw),
  );
  const hasVoiceKeyword = VOICE_KEYWORDS.some((kw) =>
    lowerContent.includes(kw),
  );
  const hasAutomationKeyword = AUTOMATION_KEYWORDS.some((kw) =>
    lowerContent.includes(kw),
  );

  if (hasMusicKeyword || hasVoiceKeyword || hasAutomationKeyword) {
    return "music";
  }

  // Check for admin/moderation keywords
  const hasAdminKeyword = ADMIN_KEYWORDS.some((kw) =>
    lowerContent.includes(kw),
  );

  if (hasAdminKeyword) {
    return "admin";
  }

  // Default to general agent for everything else
  return "general";
}

/**
 * Get a description of what each agent type handles (for debugging/logging)
 */
export function getAgentDescription(agentType: AgentType): string {
  switch (agentType) {
    case "general":
      return "everyday Discord interactions, messaging, polls, elections, birthdays";
    case "admin":
      return "server administration, moderation, roles, webhooks, events";
    case "music":
      return "music playback, voice channels, automation, external APIs";
  }
}
