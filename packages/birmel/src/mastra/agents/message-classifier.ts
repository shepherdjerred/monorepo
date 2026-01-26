/**
 * Keyword-based classifier to route messages to specialized agents.
 * Used as a fallback when Agent Networks aren't available.
 */

import type { AgentType } from "../tools/tool-sets.js";

// Keywords for each agent type
const MESSAGING_KEYWORDS = [
  "send",
  "message",
  "reply",
  "edit message",
  "delete message",
  "pin",
  "unpin",
  "react",
  "reaction",
  "thread",
  "poll",
  "vote",
  "schedule message",
  "remember",
  "memory",
  "forget",
];

const SERVER_KEYWORDS = [
  "server",
  "guild",
  "channel",
  "create channel",
  "delete channel",
  "member",
  "members",
  "who is",
  "list members",
  "search",
  "database",
  "query",
];

const MODERATION_KEYWORDS = [
  "kick",
  "ban",
  "unban",
  "mute",
  "timeout",
  "warn",
  "moderate",
  "role",
  "roles",
  "assign role",
  "remove role",
  "create role",
  "permissions",
  "automod",
  "webhook",
  "invite",
  "emoji",
  "sticker",
  "prune",
];

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
  "playlist",
  "track",
  "join voice",
  "leave voice",
  "voice channel",
];

const AUTOMATION_KEYWORDS = [
  "remind",
  "reminder",
  "timer",
  "alarm",
  "schedule",
  "later",
  "tomorrow",
  "in an hour",
  "run command",
  "execute",
  "shell",
  "browser",
  "screenshot",
  "weather",
  "news",
  "election",
  "vote",
  "candidate",
  "birthday",
  "event",
  "schedule event",
];

const EDITOR_KEYWORDS = [
  "edit file",
  "edit code",
  "edit repo",
  "edit repository",
  "update file",
  "update code",
  "modify file",
  "modify code",
  "change file",
  "change code",
  "style card",
  "config file",
  "pull request",
  "pr",
  "create pr",
  "make changes",
  "code change",
];

/**
 * Classify a message to determine which agent type should handle it.
 */
export function classifyMessage(content: string): AgentType {
  const lowerContent = content.toLowerCase();

  // Check each category and count matches
  const scores: Record<AgentType, number> = {
    messaging: 0,
    server: 0,
    moderation: 0,
    music: 0,
    automation: 0,
    editor: 0,
  };

  for (const kw of MUSIC_KEYWORDS) {
    if (lowerContent.includes(kw)) scores.music++;
  }
  for (const kw of MODERATION_KEYWORDS) {
    if (lowerContent.includes(kw)) scores.moderation++;
  }
  for (const kw of AUTOMATION_KEYWORDS) {
    if (lowerContent.includes(kw)) scores.automation++;
  }
  for (const kw of SERVER_KEYWORDS) {
    if (lowerContent.includes(kw)) scores.server++;
  }
  for (const kw of MESSAGING_KEYWORDS) {
    if (lowerContent.includes(kw)) scores.messaging++;
  }
  for (const kw of EDITOR_KEYWORDS) {
    if (lowerContent.includes(kw)) scores.editor++;
  }

  // Find the highest scoring agent type
  let maxScore = 0;
  let bestType: AgentType = "messaging"; // default

  for (const [type, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestType = type as AgentType;
    }
  }

  return bestType;
}

/**
 * Check if a message might need multiple agents (for logging/debugging)
 */
export function detectMultiAgentNeed(content: string): AgentType[] {
  const lowerContent = content.toLowerCase();
  const needed: AgentType[] = [];

  if (MUSIC_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
    needed.push("music");
  }
  if (MODERATION_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
    needed.push("moderation");
  }
  if (AUTOMATION_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
    needed.push("automation");
  }
  if (SERVER_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
    needed.push("server");
  }
  if (MESSAGING_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
    needed.push("messaging");
  }
  if (EDITOR_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
    needed.push("editor");
  }

  return needed.length > 0 ? needed : ["messaging"];
}
