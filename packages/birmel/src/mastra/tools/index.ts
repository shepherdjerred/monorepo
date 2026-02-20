import { allDiscordTools } from "./discord/index.ts";
import { playbackTools } from "./music/playback.ts";
import { queueTools } from "./music/queue.ts";
import { externalServiceTool } from "./external/web.ts";
import { manageMemoryTool } from "./memory/index.ts";
import { sqliteTools } from "./database/sqlite-query.ts";
import { electionTools } from "./elections/elections.ts";
import { executeShellCommandTool } from "./automation/shell.ts";
import { manageTaskTool } from "./automation/timers.ts";
import { browserAutomationTool } from "./automation/browser.ts";
import { manageBirthdayTool } from "./birthdays/index.ts";

function toolsToRecord(tools: { id: string }[]): Record<string, unknown> {
  return Object.fromEntries(tools.map((tool) => [tool.id, tool]));
}

export const allTools: Record<string, unknown> = {
  ...toolsToRecord(allDiscordTools),
  ...toolsToRecord(playbackTools),
  ...toolsToRecord(queueTools),
  ...toolsToRecord([externalServiceTool]),
  ...toolsToRecord([manageMemoryTool]),
  ...toolsToRecord(sqliteTools),
  ...toolsToRecord(electionTools),
  ...toolsToRecord([
    executeShellCommandTool,
    manageTaskTool,
    browserAutomationTool,
  ]),
  ...toolsToRecord([manageBirthdayTool]),
};
