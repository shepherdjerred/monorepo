import {
  BirmelToolMetadataSchema,
  type BirmelToolMetadata,
  type ToolRiskClass,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { z } from "zod";

const ToolActionInputSchema = z.object({ action: z.string() }).loose();

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
  ["manage-message", metadata("manage-message", "write", 30_000, ["get"])],
  [
    "manage-thread",
    metadata("manage-thread", "write", 30_000, ["get-messages", "summarize"]),
  ],
  ["manage-poll", metadata("manage-poll", "write", 30_000, ["get-results"])],
  ["get-activity-stats", metadata("get-activity-stats", "read")],
  ["record-activity", metadata("record-activity", "write")],
  ["manage-memory", metadata("manage-memory", "write")],
  ["manage-agent-session", metadata("manage-agent-session", "write")],
  ["run-code", metadata("run-code", "code-execution", 15_000)],
  ["manage-job", metadata("manage-job", "write")],
  [
    "browser-automation",
    metadata("browser-automation", "write", 120_000, [
      "tabs",
      "snapshot",
      "screenshot",
      "get-text",
    ]),
  ],
  ["external-service", metadata("external-service", "read", 120_000)],
  ["web-research", metadata("web-research", "read", 120_000)],
  [
    "manage-scheduled-event",
    metadata("manage-scheduled-event", "write", 30_000, ["list", "get-users"]),
  ],
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

export function toolRequiresExternalEffectCheckpoint(
  toolId: string,
  input?: unknown,
): boolean {
  if (toolId === "run-code") {
    return false;
  }
  const toolMetadata = getToolMetadata(toolId);
  if (toolMetadata.riskClass === "read") {
    return false;
  }
  const parsedInput = ToolActionInputSchema.safeParse(input);
  const action = parsedInput.success ? parsedInput.data.action : undefined;
  return (
    typeof action !== "string" ||
    toolMetadata.readActions?.includes(action) !== true
  );
}

export function getRegisteredToolMetadata(): BirmelToolMetadata[] {
  return [...TOOL_METADATA.values()];
}
