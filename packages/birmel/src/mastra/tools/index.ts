export { allDiscordTools } from "./discord/index.js";
export { allMusicTools } from "./music/index.js";
export { allExternalTools } from "./external/index.js";
export { memoryTools } from "./memory/index.js";
export { sqliteTools } from "./database/sqlite-query.js";
export { electionTools } from "./elections/elections.js";
export { allAutomationTools } from "./automation/index.js";
export type { ToolResult, ToolContext } from "./types.js";

import { allDiscordTools } from "./discord/index.js";
import { allMusicTools } from "./music/index.js";
import { allExternalTools } from "./external/index.js";
import { memoryTools } from "./memory/index.js";
import { sqliteTools } from "./database/sqlite-query.js";
import { electionTools } from "./elections/elections.js";
import { allAutomationTools } from "./automation/index.js";

// Create a properly typed tools record for Mastra Agent
const discordToolsRecord = Object.fromEntries(
  allDiscordTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof allDiscordTools)[number]>;

const musicToolsRecord = Object.fromEntries(
  allMusicTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof allMusicTools)[number]>;

const externalToolsRecord = Object.fromEntries(
  allExternalTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof allExternalTools)[number]>;

const memoryToolsRecord = Object.fromEntries(
  memoryTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof memoryTools)[number]>;

const sqliteToolsRecord = Object.fromEntries(
  sqliteTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof sqliteTools)[number]>;

const electionToolsRecord = Object.fromEntries(
  electionTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof electionTools)[number]>;

const automationToolsRecord = Object.fromEntries(
  allAutomationTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof allAutomationTools)[number]>;

export const allTools = {
  ...discordToolsRecord,
  ...musicToolsRecord,
  ...externalToolsRecord,
  ...memoryToolsRecord,
  ...sqliteToolsRecord,
  ...electionToolsRecord,
  ...automationToolsRecord,
};
