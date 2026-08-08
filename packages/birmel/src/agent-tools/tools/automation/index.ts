import { executeShellCommandTool } from "./shell.ts";
import { manageJobTool } from "./agent-jobs.ts";
import { browserAutomationTool } from "./browser.ts";

export const allAutomationTools = [
  executeShellCommandTool,
  manageJobTool,
  browserAutomationTool,
];
