export const BOT_NAME = "Birmel";

export const TRIGGER_PATTERNS = [
  /\bbirmel\b/i,
  /\bhey birmel\b/i,
  /\byo birmel\b/i,
  /\bok birmel\b/i,
] as const;

export const DISCORD_MESSAGE_LIMIT = 2000;

export const RATE_LIMITS = {
  messagesPerMinute: 30,
  commandsPerMinute: 10,
  voiceCommandsPerMinute: 5,
  codeRequestsPerHour: 5,
} as const;

export const AUDIO = {
  sampleRate: 48000,
  channels: 2,
  frameSize: 960,
} as const;

export const TIMEOUTS = {
  discordApiMs: 30_000,
  whisperApiMs: 60_000,
  ttsApiMs: 30_000,
  agentResponseMs: 120_000,
  claudeCodeMs: 600_000, // 10 minutes for code generation
} as const;
