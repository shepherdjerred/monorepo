export { allDiscordTools } from "./discord/index.ts";
export { allMusicTools } from "./music/index.ts";
export { allExternalTools } from "./external/index.ts";
export { memoryTools } from "./memory/index.ts";
export { sqliteTools } from "./database/sqlite-query.ts";
export { electionTools } from "./elections/elections.ts";
export { allAutomationTools } from "./automation/index.ts";
export { birthdayTools } from "./birthdays/index.ts";
export type { ToolResult, ToolContext } from "./types.ts";

import { allDiscordTools } from "./discord/index.ts";
import { allMusicTools } from "./music/index.ts";
import { allExternalTools } from "./external/index.ts";
import { memoryTools } from "./memory/index.ts";
import { sqliteTools } from "./database/sqlite-query.ts";
import { electionTools } from "./elections/elections.ts";
import { allAutomationTools } from "./automation/index.ts";
import { birthdayTools } from "./birthdays/index.ts";

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

const birthdayToolsRecord = Object.fromEntries(
  birthdayTools.map((tool) => [tool.id, tool]),
) as Record<string, (typeof birthdayTools)[number]>;

export const allTools = {
  ...discordToolsRecord,
  ...musicToolsRecord,
  ...externalToolsRecord,
  ...memoryToolsRecord,
  ...sqliteToolsRecord,
  ...electionToolsRecord,
  ...automationToolsRecord,
  ...birthdayToolsRecord,
};
