import { executeShellCommandTool } from "./shell.ts";
import { manageTaskTool } from "./timers.ts";
import { browserAutomationTool } from "./browser.ts";

export { executeShellCommandTool } from "./shell.ts";
export { manageTaskTool, timerTools } from "./timers.ts";
export { browserAutomationTool, browserTools } from "./browser.ts";

export const allAutomationTools = [
  executeShellCommandTool,
  manageTaskTool,
  browserAutomationTool,
];
