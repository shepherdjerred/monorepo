import { executeShellCommandTool } from "./shell.ts";
import { manageTaskTool } from "./timers.ts";
import { browserAutomationTool } from "./browser.ts";

export const allAutomationTools = [
  executeShellCommandTool,
  manageTaskTool,
  browserAutomationTool,
];
