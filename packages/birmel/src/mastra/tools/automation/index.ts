import { executeShellCommandTool } from "./shell.ts";
import { manageTaskTool } from "./timers.ts";
import { browserAutomationTool } from "./browser.ts";

export { executeShellCommandTool } from "./shell.js";
export { manageTaskTool, timerTools } from "./timers.js";
export { browserAutomationTool, browserTools } from "./browser.js";

export const allAutomationTools = [
  executeShellCommandTool,
  manageTaskTool,
  browserAutomationTool,
];
