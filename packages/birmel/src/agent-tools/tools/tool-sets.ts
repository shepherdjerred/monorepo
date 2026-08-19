import type { ToolSet } from "ai";
import { z } from "zod";
import {
  BirmelToolMetadataSchema,
  SpecialistIdSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { getRegisteredToolMetadata } from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";

/**
 * Specialized tool sets for different agent types.
 * Each tool belongs to exactly one of the six specialist agents.
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
import { playbackTools } from "./music/playback.ts";
import { queueTools } from "./music/queue.ts";
import { playlistTools } from "./music/playlists.ts";
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
import { editRepoTool } from "./editor/edit-repo.ts";
import { listReposTool } from "./editor/list-repos.ts";
import { getSessionTool } from "./editor/get-session.ts";
import { approveChangesTool } from "./editor/approve-changes.ts";
import { connectGitHubTool } from "./editor/connect-github.ts";

/**
 * Messaging Agent - handles messages, threads, polls, memory, and sessions
 */
export const messagingToolSet = [
  ...messageTools,
  ...threadTools,
  ...pollTools,
  ...activityTools,
  manageMemoryTool,
  manageAgentSessionTool,
];

/**
 * Server Agent - handles guild information and channels
 */
export const serverToolSet = [...guildTools, ...channelTools];

/**
 * Moderation Agent - handles moderation, roles, automod, webhooks.
 * Includes memberTools because role grants/revokes and nickname changes are
 * conceptually moderation actions; without them the moderation-agent would
 * have to delegate to server-agent for every role assignment.
 */
export const moderationToolSet = [
  ...moderationTools,
  ...roleTools,
  ...memberTools,
  ...automodTools,
  ...webhookTools,
  ...inviteTools,
  ...emojiTools,
];

/**
 * Music Agent - handles music playback
 */
export const musicToolSet = [...playbackTools, ...queueTools, ...playlistTools];

/**
 * Automation Agent - handles automation, external APIs, events, elections, birthdays
 */
export const automationToolSet = [
  executeShellCommandTool,
  manageJobTool,
  browserAutomationTool,
  externalServiceTool,
  webResearchTool,
  ...eventTools,
  ...electionTools,
  getCandidateStatsTool,
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
];

export type AgentType = z.infer<typeof SpecialistIdSchema>;

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

const CapabilityCatalogSourceSchema = z
  .object({
    id: z.string().min(1).max(64),
    description: z.string().min(1).max(600),
    birmelMetadata: BirmelToolMetadataSchema,
  })
  .loose();

export const CapabilityCatalogEntrySchema = z.strictObject({
  id: z.string().min(1).max(64),
  specialist: SpecialistIdSchema,
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
 * Build the router catalog from the actual specialist tool sets. The metadata
 * registry must match the executable inventory exactly so routing cannot
 * advertise a stale or unregistered capability.
 */
export function getCapabilityCatalog(): CapabilityCatalogEntry[] {
  const entries: CapabilityCatalogEntry[] = [];
  const observedIds = new Set<string>();
  for (const specialist of SpecialistIdSchema.options) {
    for (const rawTool of getToolSet(specialist)) {
      const tool = CapabilityCatalogSourceSchema.parse(rawTool);
      if (tool.birmelMetadata.specialist !== specialist) {
        throw new Error(
          `Tool ${tool.id} is registered under ${specialist} but owned by ${tool.birmelMetadata.specialist}`,
        );
      }
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
          specialist,
          riskClass: tool.birmelMetadata.riskClass,
          description: tool.description,
        }),
      );
    }
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
  return CapabilityCatalogSchema.parse(
    entries.toSorted((left, right) => left.id.localeCompare(right.id)),
  );
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
