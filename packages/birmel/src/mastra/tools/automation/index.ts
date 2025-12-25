import { executeShellCommandTool } from "./shell.js";
import { manageTaskTool } from "./timers.js";
import { browserAutomationTool } from "./browser.js";

export { executeShellCommandTool } from "./shell.js";
export { manageTaskTool, timerTools } from "./timers.js";
export { browserAutomationTool, browserTools } from "./browser.js";

export const allAutomationTools = [
  executeShellCommandTool,
  manageTaskTool,
  browserAutomationTool,
];
