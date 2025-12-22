export { allDiscordTools } from "./discord/index.js";
export { allMusicTools } from "./music/index.js";
export { allExternalTools } from "./external/index.js";
export { memoryTools } from "./memory/index.js";
export type { ToolResult, ToolContext } from "./types.js";

import { allDiscordTools } from "./discord/index.js";
import { allMusicTools } from "./music/index.js";
import { allExternalTools } from "./external/index.js";
import { memoryTools } from "./memory/index.js";

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

export const allTools = {
  ...discordToolsRecord,
  ...musicToolsRecord,
  ...externalToolsRecord,
  ...memoryToolsRecord,
};
