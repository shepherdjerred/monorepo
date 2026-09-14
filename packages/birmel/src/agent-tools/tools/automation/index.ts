import { runCodeTool } from "./run-code.ts";
import { manageJobTool } from "./agent-jobs.ts";
import { browserAutomationTool } from "./browser.ts";

export const allAutomationTools = [
  runCodeTool,
  manageJobTool,
  browserAutomationTool,
];
