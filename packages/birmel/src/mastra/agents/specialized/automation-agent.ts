import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { automationToolSet, toolsToRecord } from "../../tools/tool-sets.js";

const config = getConfig();

export const automationAgent = new Agent({
  id: "automation-agent",
  name: "Automation Agent",
  description: `This agent handles automation, scheduling, and external services.
    It sets reminders and timers.
    It runs shell commands and browser automation.
    It fetches weather, news, and other external data.
    It manages elections, voting, and candidates.
    It tracks birthdays and scheduled events.
    Use this agent for reminders, automation, external APIs, elections, or birthdays.`,
  instructions: `You are an automation and utilities specialist.
    Handle reminders, timers, external data fetching, and special features.
    Be helpful and proactive.`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(automationToolSet) as ToolsInput,
});
