import { allDiscordTools } from "./discord/index.ts";
import { playbackTools } from "./music/playback.ts";
import { queueTools } from "./music/queue.ts";
import { externalServiceTool } from "./external/web.ts";
import { webResearchTool } from "./external/research.ts";
import { manageMemoryTool } from "./memory/index.ts";
import { manageAgentSessionTool } from "./sessions/index.ts";
import { sqliteTools } from "./database/sqlite-query.ts";
import { electionTools } from "./elections/elections.ts";
import { executeShellCommandTool } from "./automation/shell.ts";
import { manageTaskTool } from "./automation/timers.ts";
import { manageAgentJobTool } from "./automation/agent-jobs.ts";
import { browserAutomationTool } from "./automation/browser.ts";
import { manageBirthdayTool } from "./birthdays/index.ts";

function toolsToRecord(tools: { id: string }[]): Record<string, unknown> {
  return Object.fromEntries(tools.map((tool) => [tool.id, tool]));
}

export const allTools: Record<string, unknown> = {
  ...toolsToRecord(allDiscordTools),
  ...toolsToRecord(playbackTools),
  ...toolsToRecord(queueTools),
  ...toolsToRecord([externalServiceTool, webResearchTool]),
  ...toolsToRecord([manageMemoryTool]),
  ...toolsToRecord([manageAgentSessionTool]),
  ...toolsToRecord(sqliteTools),
  ...toolsToRecord(electionTools),
  ...toolsToRecord([
    executeShellCommandTool,
    manageTaskTool,
    manageAgentJobTool,
    browserAutomationTool,
  ]),
  ...toolsToRecord([manageBirthdayTool]),
};
