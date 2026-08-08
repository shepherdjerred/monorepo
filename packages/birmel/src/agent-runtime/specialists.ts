import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";
import {
  SpecialistTaskPacketSchema,
  type SpecialistId,
  type SpecialistTaskPacket,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  getToolSet,
  toolsToRecord,
} from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getOpenAIProviderOptions } from "./provider-options.ts";
import { CORE_SYSTEM_POLICY, specialistInstructions } from "./prompts.ts";

const logger = loggers.agent.child("execution");

const ToolIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ToolResultForSessionSchema = z.object({
  toolName: ToolIdSchema,
  output: z.object({ success: z.boolean() }),
});
const SessionToolEventSchema = z.strictObject({
  toolId: ToolIdSchema,
  content: z.string().min(1).max(96),
});

type SessionToolEvent = z.infer<typeof SessionToolEventSchema>;

export type AgentExecutionResult = {
  text: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  toolEvents: SessionToolEvent[];
};

export type DirectExecutor = (
  packet: SpecialistTaskPacket,
) => Promise<AgentExecutionResult>;

export type SpecialistExecutor = (
  specialist: SpecialistId,
  packet: SpecialistTaskPacket,
) => Promise<AgentExecutionResult>;

export type IsolatedAgentOptions = {
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  textVerbosity?: "low" | "medium" | "high";
  timeoutMs?: number;
};

export function summarizeToolResultForSession(
  rawToolResult: unknown,
  registeredToolIds: readonly string[],
): SessionToolEvent {
  const toolResult = ToolResultForSessionSchema.parse(rawToolResult);
  const parsedRegisteredToolIds = z
    .array(ToolIdSchema)
    .parse(registeredToolIds);
  if (!parsedRegisteredToolIds.includes(toolResult.toolName)) {
    throw new Error(
      `AI SDK returned an unregistered tool result: ${toolResult.toolName}`,
    );
  }
  const status = toolResult.output.success ? "succeeded" : "failed";
  return SessionToolEventSchema.parse({
    toolId: toolResult.toolName,
    content: `Tool ${toolResult.toolName} ${status}`,
  });
}

function taskPrompt(packet: SpecialistTaskPacket): string {
  return `Current request from ${packet.username} (${packet.userId}):\n${packet.request}\n\nDiscord context:\nguild=${packet.guildId}\nchannel=${packet.channelId}${packet.threadId == null ? "" : `\nthread=${packet.threadId}`}\n\nRelevant context:\n${packet.context}`;
}

function taskMessages(packet: SpecialistTaskPacket) {
  return [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: taskPrompt(packet) },
        ...packet.attachments.map((attachment) => ({
          type: "image" as const,
          image: new URL(attachment.url),
          ...(attachment.contentType == null
            ? {}
            : { mediaType: attachment.contentType }),
        })),
      ],
    },
  ];
}

export const executeDirect: DirectExecutor = async (rawPacket) => {
  const packet = SpecialistTaskPacketSchema.parse(rawPacket);
  const config = getConfig();
  return await withSpan(
    "birmel.agent.direct",
    {
      guildId: packet.guildId,
      channelId: packet.channelId,
      userId: packet.userId,
      route: "direct",
      persona: packet.personaId,
      operation: "agent.direct.generate",
    },
    async (span) => {
      const startedAt = performance.now();
      const result = await generateText({
        model: openai(config.openai.model),
        system: `${CORE_SYSTEM_POLICY}\n\n${packet.persona}`,
        messages: taskMessages(packet),
        maxOutputTokens: config.openai.maxTokens,
        timeout: config.agent.responseTimeoutMs,
        providerOptions: getOpenAIProviderOptions(),
      });
      span.setAttribute("gen_ai.response.finish_reasons", result.finishReason);
      span.setAttribute(
        "gen_ai.usage.input_tokens",
        result.usage.inputTokens ?? 0,
      );
      span.setAttribute(
        "gen_ai.usage.output_tokens",
        result.usage.outputTokens ?? 0,
      );
      logger.info("Direct agent completed", {
        route: "direct",
        personaId: packet.personaId,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        stepCount: 1,
        durationMs: performance.now() - startedAt,
      });
      return {
        text: result.text,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        stepCount: 1,
        toolEvents: [],
      };
    },
  );
};

async function executeSpecialistWithOptions(
  specialist: SpecialistId,
  rawPacket: SpecialistTaskPacket,
  options: IsolatedAgentOptions,
): Promise<AgentExecutionResult> {
  const packet = SpecialistTaskPacketSchema.parse(rawPacket);
  const config = getConfig();
  const tools = toolsToRecord(getToolSet(specialist));
  const registeredToolIds = Object.keys(tools);
  return await withSpan(
    `birmel.agent.${specialist}`,
    {
      guildId: packet.guildId,
      channelId: packet.channelId,
      userId: packet.userId,
      route: specialist,
      persona: packet.personaId,
      operation: `agent.${specialist}.generate`,
    },
    async (span) => {
      const startedAt = performance.now();
      const agent = new ToolLoopAgent({
        id: `birmel-${specialist}`,
        model: openai(options.model ?? config.openai.model),
        instructions: `${specialistInstructions(specialist)}\n\n${packet.persona}`,
        tools,
        stopWhen: stepCountIs(config.agent.maxSteps),
        prepareStep: ({ stepNumber }) =>
          stepNumber >= config.agent.maxSteps - 1
            ? { activeTools: [], toolChoice: "none" }
            : undefined,
        maxOutputTokens: config.openai.maxTokens,
        providerOptions: getOpenAIProviderOptions(options),
      });
      const result = await agent.generate({
        messages: taskMessages(packet),
        timeout: options.timeoutMs ?? config.agent.responseTimeoutMs,
      });
      span.setAttribute("gen_ai.response.finish_reasons", result.finishReason);
      span.setAttribute(
        "gen_ai.usage.input_tokens",
        result.totalUsage.inputTokens ?? 0,
      );
      span.setAttribute(
        "gen_ai.usage.output_tokens",
        result.totalUsage.outputTokens ?? 0,
      );
      span.setAttribute("birmel.agent_steps", result.steps.length);
      logger.info("Specialist agent completed", {
        route: specialist,
        personaId: packet.personaId,
        finishReason: result.finishReason,
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        stepCount: result.steps.length,
        durationMs: performance.now() - startedAt,
      });
      return {
        text: result.text,
        finishReason: result.finishReason,
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        stepCount: result.steps.length,
        toolEvents: result.steps.flatMap((step) =>
          step.toolResults.map((toolResult) =>
            summarizeToolResultForSession(toolResult, registeredToolIds),
          ),
        ),
      };
    },
  );
}

export const executeSpecialist: SpecialistExecutor = async (
  specialist,
  rawPacket,
) => await executeSpecialistWithOptions(specialist, rawPacket, {});

export async function executeIsolatedAutomationAgent(
  packet: SpecialistTaskPacket,
  options: IsolatedAgentOptions,
): Promise<AgentExecutionResult> {
  return await executeSpecialistWithOptions("automation", packet, options);
}
