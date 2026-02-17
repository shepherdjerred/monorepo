import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { automationToolSet } from "../../../mastra/tools/tool-sets.js";

const config = getConfig();

export const automationAgent = new Agent({
  name: "automation-agent",
  purpose: `This agent handles automation, external APIs, and scheduling.
    It can set reminders and timers.
    It runs shell commands.
    It does browser automation.
    It fetches weather and news.
    It manages elections and birthdays.
    It schedules events.
    Use this agent for automation tasks, external integrations, or scheduling.`,
  instructions: `You are an automation specialist for Discord.
    Handle reminders, external APIs, browser automation, and scheduling.
    Be efficient and reliable.`,
  model: openai(config.openai.model),
  tools: automationToolSet,
});
