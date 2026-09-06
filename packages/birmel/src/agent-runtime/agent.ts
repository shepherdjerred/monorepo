import { Output, stepCountIs, ToolLoopAgent } from "ai";
import { redactSecrets } from "@shepherdjerred/llm-observability";
import { z } from "zod";
import {
  TaskPacketSchema,
  TurnAnswerSchema,
  type TaskPacket,
  type TurnAnswer,
  type TurnDisposition,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { allTools } from "@shepherdjerred/birmel/agent-tools/tools/index.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getLlmRuntime } from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import { getToolMetadata } from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getOpenRouterProviderOptions } from "./provider-options.ts";
import { AGENT_INSTRUCTIONS } from "./prompts.ts";

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
  disposition: TurnDisposition;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  toolEvents: SessionToolEvent[];
};

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

function taskPrompt(packet: TaskPacket): string {
  const referenceFailureText =
    packet.referenceResolutionError == null
      ? ""
      : `\n\nReference warning:\nFailed to resolve referenced message ${packet.referenceResolutionError.referencedMessageId}: ${packet.referenceResolutionError.error}`;
  return `Current request from ${packet.username} (${packet.userId}):\n${packet.request}\n\nDiscord context:\nguild=${packet.guildId}\nchannel=${packet.channelId}${packet.threadId == null ? "" : `\nthread=${packet.threadId}`}\n\nRelevant context:\n${packet.context}${referenceFailureText}`;
}

function taskMessages(packet: TaskPacket) {
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

/**
 * The anti-hallucination gate.
 *
 * The old runtime named one tool before the turn began and threw unless that
 * exact tool succeeded. That fixed the plan before any evidence existed, so an
 * ordinary "this actually needs a different tool" became a hard failure.
 *
 * This checks the same property from the other end: whatever the reply says it
 * relied on must correspond to a tool call that really succeeded this turn. It
 * covers every claim rather than one pre-named tool, and it lets the agent
 * change its mind freely along the way.
 */
export function requireGroundedAnswer(
  answer: TurnAnswer,
  toolEvents: SessionToolEvent[],
): void {
  const succeeded = new Set(
    toolEvents
      .filter(({ success }) => success)
      .map(({ toolCallId }) => toolCallId),
  );
  const ungrounded = answer.reliedOnToolCallIds.filter(
    (toolCallId) => !succeeded.has(toolCallId),
  );
  if (ungrounded.length > 0) {
    throw new Error(
      `Answer cited tool calls that did not succeed this turn: ${ungrounded.join(", ")}`,
    );
  }
  // Checking the global success set is not enough: a harmless lookup can
  // succeed while the requested mutation never runs, and an answer citing
  // nothing would still pass. Supported work must cite at least one call, and
  // every cited call is already known to have succeeded by the check above.
  if (answer.disposition !== "supported") {
    return;
  }
  if (answer.reliedOnToolCallIds.length === 0) {
    throw new Error(
      "Answer claims supported work without citing a successful tool call",
    );
  }
  // Membership alone still lets the model cite an unrelated success (a
  // harmless read) while the tool that actually mattered failed later in the
  // same turn. toolEvents is chronological (built from result.steps in
  // order), so a mutating tool that fails strictly after the cited evidence
  // contradicts the claim: whatever the model did after citing its proof did
  // not go as planned, and it never came back to fix it. A failed read after
  // the citation is not contradictory - re-checking something incidental and
  // having that check fail says nothing about whether the original claim
  // holds - so only write/destructive/code-execution failures count.
  const citedToolCallIds = new Set(answer.reliedOnToolCallIds);
  const lastCitedIndex = toolEvents.findLastIndex((event) =>
    citedToolCallIds.has(event.toolCallId),
  );
  const contradiction = toolEvents
    .slice(lastCitedIndex + 1)
    .find(
      (event) =>
        !event.success && getToolMetadata(event.toolId).riskClass !== "read",
    );
  if (contradiction !== undefined) {
    throw new Error(
      `Answer claims supported work, but ${contradiction.toolId} failed after the cited evidence`,
    );
  }
}

export async function executeTurn(
  rawPacket: TaskPacket,
  options: IsolatedAgentOptions = {},
): Promise<AgentExecutionResult> {
  const packet = TaskPacketSchema.parse(rawPacket);
  const config = getConfig();
  const runtime = getLlmRuntime();
  const registeredToolIds = Object.keys(allTools);
  return await withSpan(
    "birmel.agent.turn",
    {
      guildId: packet.guildId,
      channelId: packet.channelId,
      userId: packet.userId,
      persona: packet.personaId,
      operation: "agent.turn.generate",
    },
    async (span) => {
      const startedAt = performance.now();
      const maxSteps = config.agent.maxSteps;
      const agent = new ToolLoopAgent({
        id: "birmel-agent",
        model: runtime.languageModel(options.model ?? config.openRouter.model, [
          "tools",
        ]),
        instructions: `${AGENT_INSTRUCTIONS}\n\n${packet.persona}`,
        tools: allTools,
        stopWhen: stepCountIs(maxSteps),
        // Spend the last step answering rather than starting work that cannot
        // finish. Without this the run can end mid-tool-call, and `output`
        // throws NoOutputGeneratedError because the final step never stopped.
        prepareStep: ({ stepNumber }) =>
          stepNumber >= maxSteps - 1
            ? { activeTools: [], toolChoice: "none" }
            : undefined,
        maxOutputTokens: config.openRouter.maxTokens,
        providerOptions: getOpenRouterProviderOptions(options),
        output: Output.object({ schema: TurnAnswerSchema }),
      });
      const result = await agent.generate({
        messages: taskMessages(packet),
        abortSignal: AbortSignal.timeout(
          options.timeoutMs ?? config.agent.responseTimeoutMs,
        ),
        ...runtime.callOptions({
          workload: "birmel.agent.turn",
          sessionId: packet.threadId ?? packet.channelId,
        }),
      });
      const toolEvents = result.steps.flatMap((step) =>
        step.toolResults.map((toolResult) =>
          summarizeToolResultForSession(toolResult, registeredToolIds),
        ),
      );
      const answer = TurnAnswerSchema.parse(result.output);
      requireGroundedAnswer(answer, toolEvents);
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
      span.setAttribute("birmel.turn_disposition", answer.disposition);
      logger.info("Agent turn completed", {
        disposition: answer.disposition,
        personaId: packet.personaId,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        stepCount: result.steps.length,
        toolCallCount: toolEvents.length,
        durationMs: performance.now() - startedAt,
      });
      return {
        text: answer.answer,
        disposition: answer.disposition,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        stepCount: result.steps.length,
        toolEvents,
      };
    },
  );
}

/**
 * Scheduled jobs run the same agent with the same tools. They differ only in
 * their model/effort overrides, which the job payload supplies.
 */
export async function executeIsolatedAgent(
  packet: TaskPacket,
  options: IsolatedAgentOptions,
): Promise<AgentExecutionResult> {
  return await executeTurn(packet, options);
}
