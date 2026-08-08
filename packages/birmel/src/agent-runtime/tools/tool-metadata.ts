import {
  BirmelToolMetadataSchema,
  type BirmelToolMetadata,
  type SpecialistId,
  type ToolRiskClass,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

const REQUIRED_CONTEXT = [
  "guildId",
  "channelId",
  "userId",
  "sourceMessageId",
] as const;

function metadata(
  id: string,
  specialist: SpecialistId,
  riskClass: ToolRiskClass,
  timeoutMs = 30_000,
): BirmelToolMetadata {
  return BirmelToolMetadataSchema.parse({
    id,
    specialist,
    riskClass,
    timeoutMs,
    requiredRequestContext: REQUIRED_CONTEXT,
  });
}

const TOOL_METADATA = new Map<string, BirmelToolMetadata>([
  ["manage-message", metadata("manage-message", "messaging", "write")],
  ["manage-thread", metadata("manage-thread", "messaging", "write")],
  ["manage-poll", metadata("manage-poll", "messaging", "write")],
  ["get-activity-stats", metadata("get-activity-stats", "messaging", "read")],
  ["record-activity", metadata("record-activity", "messaging", "write")],
  ["manage-memory", metadata("manage-memory", "messaging", "write")],
  [
    "manage-agent-session",
    metadata("manage-agent-session", "messaging", "write"),
  ],
  ["manage-guild", metadata("manage-guild", "server", "write")],
  ["manage-channel", metadata("manage-channel", "server", "destructive")],
  ["manage-database", metadata("manage-database", "server", "read")],
  ["moderate-member", metadata("moderate-member", "moderation", "destructive")],
  ["manage-role", metadata("manage-role", "moderation", "destructive")],
  ["manage-member", metadata("manage-member", "moderation", "destructive")],
  [
    "manage-automod-rule",
    metadata("manage-automod-rule", "moderation", "destructive"),
  ],
  ["manage-webhook", metadata("manage-webhook", "moderation", "destructive")],
  ["manage-invite", metadata("manage-invite", "moderation", "write")],
  ["manage-emoji", metadata("manage-emoji", "moderation", "destructive")],
  ["manage-sticker", metadata("manage-sticker", "moderation", "destructive")],
  ["music-playback", metadata("music-playback", "music", "write")],
  ["music-queue", metadata("music-queue", "music", "write")],
  ["music-playlist", metadata("music-playlist", "music", "write")],
  [
    "execute-shell-command",
    metadata("execute-shell-command", "automation", "code-execution", 300_000),
  ],
  ["manage-job", metadata("manage-job", "automation", "write")],
  [
    "browser-automation",
    metadata("browser-automation", "automation", "write", 120_000),
  ],
  [
    "external-service",
    metadata("external-service", "automation", "write", 120_000),
  ],
  ["web-research", metadata("web-research", "automation", "read", 120_000)],
  [
    "manage-scheduled-event",
    metadata("manage-scheduled-event", "automation", "write"),
  ],
  ["manage-election", metadata("manage-election", "automation", "write")],
  [
    "get-candidate-stats",
    metadata("get-candidate-stats", "automation", "read"),
  ],
  ["manage-birthday", metadata("manage-birthday", "automation", "write")],
  ["edit-repo", metadata("edit-repo", "editor", "code-execution", 300_000)],
  ["list-repos", metadata("list-repos", "editor", "read")],
  ["get-editor-session", metadata("get-editor-session", "editor", "read")],
  [
    "approve-changes",
    metadata("approve-changes", "editor", "code-execution", 300_000),
  ],
  ["connect-github", metadata("connect-github", "editor", "write")],
]);

export function getToolMetadata(toolId: string): BirmelToolMetadata {
  const value = TOOL_METADATA.get(toolId);
  if (value == null) {
    throw new Error(`Missing Birmel tool metadata for ${toolId}`);
  }
  return value;
}

export function getRegisteredToolMetadata(): BirmelToolMetadata[] {
  return [...TOOL_METADATA.values()];
}
