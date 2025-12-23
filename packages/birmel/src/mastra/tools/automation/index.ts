import { executeShellCommandTool } from "./shell.js";
import {
  scheduleTaskTool,
  listScheduledTasksTool,
  cancelScheduledTaskTool,
  scheduleReminderTool,
} from "./timers.js";

export { executeShellCommandTool } from "./shell.js";
export {
  scheduleTaskTool,
  listScheduledTasksTool,
  cancelScheduledTaskTool,
  scheduleReminderTool,
} from "./timers.js";

export const allAutomationTools = [
  executeShellCommandTool,
  scheduleTaskTool,
  listScheduledTasksTool,
  cancelScheduledTaskTool,
  scheduleReminderTool,
];
