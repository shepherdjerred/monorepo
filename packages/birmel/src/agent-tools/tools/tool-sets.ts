import type { ToolSet } from "ai";
import { z } from "zod";
import { BirmelToolMetadataSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { getRegisteredToolMetadata } from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

/**
 * Every registered tool, flat.
 *
 * These used to be four arrays partitioned by "specialist", with the router
 * picking a partition before any tool could run. The partition was never a
 * real boundary - it granted no authority, and it had already been bent (member
 * tools lived under moderation purely so the moderation agent would not have to
 * delegate every role change). One agent now sees all of them and decides as it
 * goes, so the only thing that matters is that the list is complete.
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
import { executeShellCommandTool } from "./automation/shell.ts";
import { manageJobTool } from "./automation/agent-jobs.ts";
import { browserAutomationTool } from "./automation/browser.ts";
import { externalServiceTool } from "./external/web.ts";
import { webResearchTool } from "./external/research.ts";
import { manageMemoryTool } from "./memory/index.ts";
import { manageAgentSessionTool } from "./sessions/index.ts";
import { electionTools } from "./elections/elections.ts";
import { getCandidateStatsTool } from "./elections/candidate-stats.ts";
import { manageBirthdayTool } from "./birthdays/index.ts";
import { generateImageTool } from "./images/generate-image.ts";

export const registeredTools = [
  ...messageTools,
  ...threadTools,
  ...pollTools,
  ...activityTools,
  manageMemoryTool,
  manageAgentSessionTool,
  ...guildTools,
  ...channelTools,
  ...moderationTools,
  ...roleTools,
  ...memberTools,
  ...automodTools,
  ...webhookTools,
  ...inviteTools,
  ...emojiTools,
  executeShellCommandTool,
  manageJobTool,
  browserAutomationTool,
  externalServiceTool,
  webResearchTool,
  ...eventTools,
  ...electionTools,
  getCandidateStatsTool,
  manageBirthdayTool,
  generateImageTool,
];

const CapabilityCatalogSourceSchema = z
  .object({
    id: z.string().min(1).max(64),
    description: z.string().min(1).max(600),
    birmelMetadata: BirmelToolMetadataSchema,
  })
  .loose();

export const CapabilityCatalogEntrySchema = z.strictObject({
  id: z.string().min(1).max(64),
  riskClass: BirmelToolMetadataSchema.shape.riskClass,
  description: z.string().min(1).max(600),
});
export type CapabilityCatalogEntry = z.infer<
  typeof CapabilityCatalogEntrySchema
>;

const CapabilityCatalogSchema = z
  .array(CapabilityCatalogEntrySchema)
  .min(1)
  .max(64);

/**
 * Describe every executable tool, and assert the metadata registry matches the
 * executable inventory exactly.
 *
 * The router that once consumed this is gone, but the invariant is the reason
 * the function exists: metadata and executables drifting apart is how a tool
 * ends up with no timeout or risk class. Called at startup so the process
 * refuses to boot on a mismatch.
 */
export function getCapabilityCatalog(): CapabilityCatalogEntry[] {
  const entries: CapabilityCatalogEntry[] = [];
  const observedIds = new Set<string>();
  for (const rawTool of registeredTools) {
    const tool = CapabilityCatalogSourceSchema.parse(rawTool);
    if (tool.birmelMetadata.id !== tool.id) {
      throw new Error(`Tool metadata ID does not match ${tool.id}`);
    }
    if (observedIds.has(tool.id)) {
      throw new Error(`Tool ${tool.id} is registered more than once`);
    }
    observedIds.add(tool.id);
    entries.push(
      CapabilityCatalogEntrySchema.parse({
        id: tool.id,
        riskClass: tool.birmelMetadata.riskClass,
        description: tool.description,
      }),
    );
  }
  const metadataIds = getRegisteredToolMetadata()
    .map(({ id }) => id)
    .toSorted();
  const executableIds = [...observedIds].toSorted();
  if (JSON.stringify(metadataIds) !== JSON.stringify(executableIds)) {
    throw new Error(
      "Birmel tool metadata and executable capability inventory differ",
    );
  }
  const config = getConfig();
  const advertisedEntries = entries.filter((entry) => {
    if (entry.id === "generate-image" && !config.imageGeneration.enabled) {
      return false;
    }
    return true;
  });
  return CapabilityCatalogSchema.parse(
    advertisedEntries.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
  );
}

/**
 * Tools the live agent may call this turn. generate-image stays registered
 * for metadata/startup inventory, but a disabled flag must not advertise it
 * to the model: the tool returns immediately, and the grounded-answer gate
 * then fails the whole turn.
 */
export function toolsForTurn(): ToolSet {
  const config = getConfig();
  const tools = config.imageGeneration.enabled
    ? registeredTools
    : registeredTools.filter((tool) => tool.id !== "generate-image");
  return toolsToRecord(tools);
}

/**
 * Convert a tool array to a record keyed by tool id.
 *
 * Tool schemas differ across the set, so validate their shared AI SDK shape
 * at registration and retain the AI SDK's heterogeneous ToolSet type.
 */
type AiSdkTool = ToolSet[string];

const AiSdkToolShapeSchema = z
  .object({ inputSchema: z.unknown(), execute: z.function() })
  .loose();
const AiSdkToolSchema = z.custom<AiSdkTool>(
  (value) => AiSdkToolShapeSchema.safeParse(value).success,
  "Invalid AI SDK tool registration",
);

export function toolsToRecord(tools: readonly { id: string }[]): ToolSet {
  const result: ToolSet = {};
  for (const tool of tools) {
    result[tool.id] = AiSdkToolSchema.parse(tool);
  }
  return result;
}
