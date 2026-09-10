import { Output, stepCountIs, ToolLoopAgent } from "ai";
import { redactSecrets } from "@shepherdjerred/llm-observability";
import { z } from "zod";
import {
  TaskPacketSchema,
  TurnAnswerSchema,
  type TaskPacket,
  type TurnDisposition,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { toolsForTurn } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getLlmRuntime } from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import { generateValidatedObject } from "@shepherdjerred/llm-runtime";
import { getToolMetadata } from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getOpenRouterProviderOptions } from "./provider-options.ts";
import { AGENT_INSTRUCTIONS } from "./prompts.ts";
import type { ProgressReporter } from "./progress.ts";
import {
  applyCitationRepair,
  citationRetryPrompt,
  needsCitationRetry,
  requireGroundedAnswer,
  withResolvedCitations,
} from "./citation-repair.ts";

const logger = loggers.agent.child("execution");

const ToolIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const EffectDispositionSchema = z.enum(["not_applied", "applied", "unknown"]);
const ToolDomainResultSchema = z.object({
  success: z.boolean(),
  message: z.string().min(1),
  effectDisposition: EffectDispositionSchema.optional(),
});
const ToolResultForSessionSchema = z.object({
  toolCallId: z.string().min(1).max(200),
  toolName: ToolIdSchema,
  input: z.unknown(),
  output: ToolDomainResultSchema,
});
const SessionToolEventSchema = z.strictObject({
  toolCallId: z.string().min(1).max(200),
  toolId: ToolIdSchema,
  inputSummary: z.string().min(1).max(384),
  resultSummary: z.string().min(1).max(384),
  content: z.string().min(1).max(1024),
  success: z.boolean(),
  effectDisposition: EffectDispositionSchema.optional(),
  // A structural hash of the raw, unredacted input. Matching on the action
  // field alone (an earlier version of this check) was not enough: composite
  // tools like manage-role take a "create" action for many different roles,
  // so an unrelated later create could still "correct" an earlier one that
  // targeted something else entirely. Bun.hash is key-order independent and
  // varies with any field's value, so two calls hash equal only when their
  // full input does - the only generic, per-tool-agnostic way to tell "this
  // exact operation was retried" from "a similar-shaped one happened to run."
  inputKey: z.string(),
  // Whether this specific call was inherently non-mutating, independent of
  // the tool's own overall riskClass. A composite tool like manage-role
  // exposes read actions (list, get) alongside destructive ones (create,
  // delete) under one tool-level risk class; treating a failed list as an
  // uncorrected write would reject a turn over a harmless read failure that
  // says nothing about whether the actual requested mutation succeeded.
  readOnly: z.boolean(),
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

export type TurnOptions = {
  /**
   * Live progress sink. Absent for scheduled jobs, which own no Discord
   * message to narrate into.
   */
  progress?: ProgressReporter | undefined;
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

/**
 * A JSON string with object keys sorted recursively, so two inputs that
 * differ only in key order canonicalize identically. Bun.hash's own object
 * overload does this internally, but its declared type only accepts
 * string/buffer input; canonicalizing here keeps hashing on that well-typed
 * path instead of asserting `unknown` past the type checker.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${canonicalize(entryValue)}`,
      );
    return `{${entries.join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

function boundedSummary(value: unknown): string {
  const redacted = redactSecrets(value);
  const serialized = z
    .string()
    .min(1)
    .parse(typeof redacted === "string" ? redacted : JSON.stringify(redacted));
  return boundedText(serialized, 384);
}

const ActionInputSchema = z.object({ action: z.string().max(64) }).loose();

/**
 * Whether a call was inherently non-mutating, checked per call rather than
 * per tool. A tool's own riskClass is coarse by design (create-tool.ts uses
 * it to gate effect checkpointing for the whole tool), so a composite tool
 * with a "destructive" riskClass still needs its individual read actions
 * (declared as readActions in tool metadata) recognized as reads here.
 */
function isReadOnlyCall(toolId: string, input: unknown): boolean {
  const metadata = getToolMetadata(toolId);
  if (metadata.riskClass === "read") {
    return true;
  }
  const action = ActionInputSchema.safeParse(input);
  return (
    action.success &&
    (metadata.readActions?.includes(action.data.action) ?? false)
  );
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
    inputKey: Bun.hash(canonicalize(toolResult.input)).toString(),
    readOnly: isReadOnlyCall(toolResult.toolName, toolResult.input),
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

export async function executeTurn(
  rawPacket: TaskPacket,
  options: IsolatedAgentOptions & TurnOptions = {},
): Promise<AgentExecutionResult> {
  const packet = TaskPacketSchema.parse(rawPacket);
  const config = getConfig();
  const runtime = getLlmRuntime();
  const tools = toolsForTurn();
  const registeredToolIds = Object.keys(tools);
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
      const abortSignal = AbortSignal.timeout(
        options.timeoutMs ?? config.agent.responseTimeoutMs,
      );
      const agent = new ToolLoopAgent({
        id: "birmel-agent",
        model: runtime.languageModel(options.model ?? config.openRouter.model, [
          "tools",
        ]),
        instructions: `${AGENT_INSTRUCTIONS}\n\n${packet.persona}`,
        tools,
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
      const progress = options.progress;
      const result = await agent.generate({
        messages: taskMessages(packet),
        abortSignal,
        ...(progress === undefined
          ? {}
          : {
              onToolExecutionStart: ({ toolCall }) => {
                progress.toolStarted(
                  toolCall.toolCallId,
                  toolCall.toolName,
                  toolCall.input,
                );
              },
              onToolExecutionEnd: ({
                toolCall,
                toolOutput,
                toolExecutionMs,
              }) => {
                // A tool that resolves rather than throws still reports its
                // own success/failure inside the resolved value (the same
                // field summarizeToolResultForSession reads), so a validation
                // failure inside the tool would otherwise render as a
                // misleading ✓. Fall back to "resolved at all" only for a
                // shape this check does not recognize.
                const domainResult = ToolDomainResultSchema.safeParse(
                  toolOutput.type === "tool-result"
                    ? toolOutput.output
                    : undefined,
                );
                const succeeded = domainResult.success
                  ? domainResult.data.success
                  : toolOutput.type !== "tool-error";
                progress.toolFinished(
                  toolCall.toolCallId,
                  succeeded,
                  toolExecutionMs,
                );
              },
              onStepStart: ({ stepNumber }) => {
                progress.stepStarted(stepNumber);
              },
              onStepFinish: ({ stepNumber, text, toolCalls }) => {
                // The finishing step answers with structured TurnAnswer JSON
                // and calls no tool, so its "text" is wire JSON, not the
                // requested plain-language sentence. Narration only ever
                // comes from a step that actually did something.
                if (toolCalls.length > 0) {
                  progress.stepFinished(stepNumber, text);
                }
              },
            }),
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
      let inputTokens = result.usage.inputTokens ?? 0;
      let outputTokens = result.usage.outputTokens ?? 0;
      let answer = withResolvedCitations(
        TurnAnswerSchema.parse(result.output),
        toolEvents,
      );
      if (needsCitationRetry(answer, toolEvents)) {
        logger.info(
          "Retrying structured answer to cite successful tool calls",
          {
            successfulToolCallCount: toolEvents.filter((event) => event.success)
              .length,
          },
        );
        const retried = await generateValidatedObject(runtime, {
          model: options.model ?? config.openRouter.model,
          schema: TurnAnswerSchema,
          schemaName: "birmel_turn_answer",
          prompt: citationRetryPrompt(answer, toolEvents),
          workload: "birmel.agent.turn.citation-retry",
          abortSignal,
          maxOutputTokens: config.openRouter.maxTokens,
          reasoningEffort:
            options.reasoningEffort ?? config.openRouter.reasoningEffort,
          sessionId: packet.threadId ?? packet.channelId,
        });
        const retriedAnswer = TurnAnswerSchema.parse(retried.object);
        inputTokens += retried.usage.tokens.input;
        outputTokens += retried.usage.tokens.output;
        answer = withResolvedCitations(
          applyCitationRepair(answer, retriedAnswer),
          toolEvents,
        );
      }
      requireGroundedAnswer(answer, toolEvents);
      span.setAttribute("gen_ai.response.finish_reasons", result.finishReason);
      span.setAttribute("gen_ai.usage.input_tokens", inputTokens);
      span.setAttribute("gen_ai.usage.output_tokens", outputTokens);
      span.setAttribute("birmel.agent_steps", result.steps.length);
      span.setAttribute("birmel.turn_disposition", answer.disposition);
      logger.info("Agent turn completed", {
        disposition: answer.disposition,
        personaId: packet.personaId,
        finishReason: result.finishReason,
        inputTokens,
        outputTokens,
        stepCount: result.steps.length,
        toolCallCount: toolEvents.length,
        durationMs: performance.now() - startedAt,
      });
      return {
        text: answer.answer,
        disposition: answer.disposition,
        finishReason: result.finishReason,
        inputTokens,
        outputTokens,
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
