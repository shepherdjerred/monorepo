import {
  BirmelToolMetadataSchema,
  type BirmelToolMetadata,
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
  riskClass: ToolRiskClass,
  timeoutMs = 30_000,
  readActions?: readonly string[],
): BirmelToolMetadata {
  return BirmelToolMetadataSchema.parse({
    id,
    riskClass,
    timeoutMs,
    requiredRequestContext: REQUIRED_CONTEXT,
    ...(readActions === undefined ? {} : { readActions }),
  });
}

const TOOL_METADATA = new Map<string, BirmelToolMetadata>([
  ["manage-message", metadata("manage-message", "write")],
  ["manage-thread", metadata("manage-thread", "write")],
  ["manage-poll", metadata("manage-poll", "write")],
  ["get-activity-stats", metadata("get-activity-stats", "read")],
  ["record-activity", metadata("record-activity", "write")],
  ["manage-memory", metadata("manage-memory", "write")],
  ["manage-agent-session", metadata("manage-agent-session", "write")],
  [
    "manage-guild",
    metadata("manage-guild", "write", 30_000, [
      "get-info",
      "get-owner",
      "get-audit-logs",
    ]),
  ],
  ["manage-channel", metadata("manage-channel", "destructive")],
  ["moderate-member", metadata("moderate-member", "destructive")],
  [
    "manage-role",
    metadata("manage-role", "destructive", 30_000, ["list", "get"]),
  ],
  ["manage-member", metadata("manage-member", "destructive")],
  ["manage-automod-rule", metadata("manage-automod-rule", "destructive")],
  ["manage-webhook", metadata("manage-webhook", "destructive")],
  ["manage-invite", metadata("manage-invite", "write")],
  ["manage-emoji", metadata("manage-emoji", "destructive")],
  ["manage-sticker", metadata("manage-sticker", "destructive")],
  [
    "execute-shell-command",
    metadata("execute-shell-command", "code-execution", 300_000),
  ],
  ["manage-job", metadata("manage-job", "write")],
  ["browser-automation", metadata("browser-automation", "write", 120_000)],
  ["external-service", metadata("external-service", "write", 120_000)],
  ["web-research", metadata("web-research", "read", 120_000)],
  ["manage-scheduled-event", metadata("manage-scheduled-event", "write")],
  ["manage-election", metadata("manage-election", "write")],
  ["get-candidate-stats", metadata("get-candidate-stats", "read")],
  ["manage-birthday", metadata("manage-birthday", "write")],
  ["generate-image", metadata("generate-image", "write", 60_000)],
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
