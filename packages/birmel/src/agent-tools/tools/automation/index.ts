import { executeShellCommandTool } from "./shell.ts";
import { manageTaskTool } from "./timers.ts";
import { manageAgentJobTool } from "./agent-jobs.ts";
import { browserAutomationTool } from "./browser.ts";

export const allAutomationTools = [
  executeShellCommandTool,
  manageTaskTool,
  manageAgentJobTool,
  browserAutomationTool,
];
