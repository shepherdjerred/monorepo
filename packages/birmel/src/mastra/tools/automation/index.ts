import { executeShellCommandTool } from "./shell.js";
import { manageTaskTool } from "./timers.js";
import { browserAutomationTool } from "./browser.js";
import { codeRequestTool } from "./code-request.js";

export { executeShellCommandTool } from "./shell.js";
export { manageTaskTool, timerTools } from "./timers.js";
export { browserAutomationTool, browserTools } from "./browser.js";
export { codeRequestTool } from "./code-request.js";

export const allAutomationTools = [
  executeShellCommandTool,
  manageTaskTool,
  browserAutomationTool,
  codeRequestTool,
];
