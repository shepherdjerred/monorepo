import { generateText, stepCountIs, ToolLoopAgent } from "ai";
import { redactSecrets } from "@shepherdjerred/llm-observability";
import { z } from "zod";
import {
  RouteDecisionSchema,
  SpecialistTaskPacketSchema,
  type RouteDecision,
  type SpecialistId,
  type SpecialistTaskPacket,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  getToolSet,
  toolsToRecord,
} from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getLlmRuntime } from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getOpenRouterProviderOptions } from "./provider-options.ts";
import {
  directInstructions,
  isolatedSpecialistInstructions,
  specialistInstructions,
} from "./prompts.ts";

const logger = loggers.agent.child("execution");

const ToolIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const EffectDispositionSchema = z.enum(["not_applied", "applied", "unknown"]);
const ToolResultForSessionSchema = z.object({
  toolCallId: z.string().min(1).max(200),
  toolName: ToolIdSchema,
  input: z.unknown(),
  output: z.object({
    success: z.boolean(),
    message: z.string().min(1),
    effectDisposition: EffectDispositionSchema.optional(),
  }),
});
const SessionToolEventSchema = z.strictObject({
  toolCallId: z.string().min(1).max(200),
  toolId: ToolIdSchema,
  inputSummary: z.string().min(1).max(384),
  resultSummary: z.string().min(1).max(384),
  content: z.string().min(1).max(1024),
  success: z.boolean(),
  effectDisposition: EffectDispositionSchema.optional(),
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
  decision: RouteDecision,
) => Promise<AgentExecutionResult>;

export type SpecialistExecutor = (
  specialist: SpecialistId,
  packet: SpecialistTaskPacket,
  decision: RouteDecision,
) => Promise<AgentExecutionResult>;

export type IsolatedAgentOptions = {
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  textVerbosity?: "low" | "medium" | "high";
  timeoutMs?: number;
};

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

function boundedSummary(value: unknown): string {
  const redacted = redactSecrets(value);
  const serialized = z
    .string()
    .min(1)
    .parse(typeof redacted === "string" ? redacted : JSON.stringify(redacted));
  return boundedText(serialized, 384);
}

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
  const inputSummary = boundedSummary(toolResult.input);
  const resultSummary = toolResult.output.success
    ? boundedSummary(toolResult.output.message)
    : "Tool reported failure";
  const content = boundedText(
    `Tool ${toolResult.toolName} call ${toolResult.toolCallId} ${status}; input=${inputSummary}; result=${resultSummary}`,
    1024,
  );
  return SessionToolEventSchema.parse({
    toolCallId: toolResult.toolCallId,
    toolId: toolResult.toolName,
    inputSummary,
    resultSummary,
    content,
    success: toolResult.output.success,
    ...(toolResult.output.effectDisposition == null
      ? {}
      : { effectDisposition: toolResult.output.effectDisposition }),
  });
}

export function requireSuccessfulPrimaryTool(
  rawDecision: RouteDecision,
  toolEvents: SessionToolEvent[],
): void {
  const decision = RouteDecisionSchema.parse(rawDecision);
  if (decision.disposition !== "supported") {
    throw new Error("Specialist execution requires a supported route decision");
  }
  const succeeded = toolEvents.some(
    ({ toolId, success }) => toolId === decision.primaryToolId && success,
  );
  if (!succeeded) {
    throw new Error(
      `Supported route did not complete its primary tool successfully: ${decision.primaryToolId ?? "null"}`,
    );
  }
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

export const executeDirect: DirectExecutor = async (rawPacket, rawDecision) => {
  const packet = SpecialistTaskPacketSchema.parse(rawPacket);
  const decision = RouteDecisionSchema.parse(rawDecision);
  if (decision.route !== "direct") {
    throw new Error("Direct executor received a specialist route");
  }
  const config = getConfig();
  const runtime = getLlmRuntime();
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
        model: runtime.languageModel(config.openRouter.model),
        system: `${directInstructions(decision)}\n\n${packet.persona}`,
        messages: taskMessages(packet),
        maxOutputTokens: config.openRouter.maxTokens,
        abortSignal: AbortSignal.timeout(config.agent.responseTimeoutMs),
        providerOptions: getOpenRouterProviderOptions(),
        ...runtime.callOptions({
          workload: "birmel.agent.direct",
          sessionId: packet.threadId ?? packet.channelId,
        }),
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
  decision: RouteDecision | null,
  options: IsolatedAgentOptions,
): Promise<AgentExecutionResult> {
  const packet = SpecialistTaskPacketSchema.parse(rawPacket);
  const config = getConfig();
  const runtime = getLlmRuntime();
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
        model: runtime.languageModel(options.model ?? config.openRouter.model, [
          "tools",
        ]),
        instructions: `${
          decision === null
            ? isolatedSpecialistInstructions(specialist)
            : specialistInstructions(specialist, decision)
        }\n\n${packet.persona}`,
        tools,
        stopWhen: stepCountIs(config.agent.maxSteps),
        prepareStep: ({ stepNumber }) =>
          stepNumber >= config.agent.maxSteps - 1
            ? { activeTools: [], toolChoice: "none" }
            : undefined,
        maxOutputTokens: config.openRouter.maxTokens,
        providerOptions: getOpenRouterProviderOptions(options),
      });
      const result = await agent.generate({
        messages: taskMessages(packet),
        abortSignal: AbortSignal.timeout(
          options.timeoutMs ?? config.agent.responseTimeoutMs,
        ),
        ...runtime.callOptions({
          workload: `birmel.agent.${specialist}`,
          sessionId: packet.threadId ?? packet.channelId,
        }),
      });
      const toolEvents = result.steps.flatMap((step) =>
        step.toolResults.map((toolResult) =>
          summarizeToolResultForSession(toolResult, registeredToolIds),
        ),
      );
      if (decision !== null) {
        requireSuccessfulPrimaryTool(decision, toolEvents);
        span.setAttribute("birmel.primary_tool_succeeded", true);
      }
      span.setAttribute("gen_ai.response.finish_reasons", result.finishReason);
      span.setAttribute(
        "gen_ai.usage.input_tokens",
        result.usage.inputTokens ?? 0,
      );
      span.setAttribute(
        "gen_ai.usage.output_tokens",
        result.usage.outputTokens ?? 0,
      );
      span.setAttribute("birmel.agent_steps", result.steps.length);
      logger.info("Specialist agent completed", {
        route: specialist,
        personaId: packet.personaId,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        stepCount: result.steps.length,
        durationMs: performance.now() - startedAt,
      });
      return {
        text: result.text,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        stepCount: result.steps.length,
        toolEvents,
      };
    },
  );
}

export const executeSpecialist: SpecialistExecutor = async (
  specialist,
  rawPacket,
  decision,
) => await executeSpecialistWithOptions(specialist, rawPacket, decision, {});

export async function executeIsolatedAutomationAgent(
  packet: SpecialistTaskPacket,
  options: IsolatedAgentOptions,
): Promise<AgentExecutionResult> {
  return await executeSpecialistWithOptions(
    "automation",
    packet,
    null,
    options,
  );
}
