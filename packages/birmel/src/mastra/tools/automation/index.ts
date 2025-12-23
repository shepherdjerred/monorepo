import { executeShellCommandTool } from "./shell.js";
import {
  scheduleTaskTool,
  listScheduledTasksTool,
  cancelScheduledTaskTool,
  scheduleReminderTool,
} from "./timers.js";
import {
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
  browserGetTextTool,
  browserCloseTool,
} from "./browser.js";

export { executeShellCommandTool } from "./shell.js";
export {
  scheduleTaskTool,
  listScheduledTasksTool,
  cancelScheduledTaskTool,
  scheduleReminderTool,
} from "./timers.js";
export {
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
  browserGetTextTool,
  browserCloseTool,
} from "./browser.js";

export const allAutomationTools = [
  executeShellCommandTool,
  scheduleTaskTool,
  listScheduledTasksTool,
  cancelScheduledTaskTool,
  scheduleReminderTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserClickTool,
  browserTypeTool,
  browserGetTextTool,
  browserCloseTool,
];
