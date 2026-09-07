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
import { toolsForTurn } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getLlmRuntime } from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import { getToolMetadata } from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getOpenRouterProviderOptions } from "./provider-options.ts";
import { AGENT_INSTRUCTIONS } from "./prompts.ts";
import type { ProgressReporter } from "./progress.ts";

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
  // Runs regardless of disposition, not only "supported": disposition is
  // itself model-generated, so a failed mutation mislabeled "conversation" or
  // "unsupported" - with nothing cited - would otherwise skip straight past
  // every other check here. Membership in the success set is not enough
  // either: a harmless lookup can succeed while the requested mutation never
  // runs, or the model can point at an unrelated success - a harmless read,
  // or a different attempt of the same tool - while the operation that
  // actually mattered failed and was never fixed. Checking only what
  // happened after a citation is not enough: the failure can come first and
  // the unrelated success get cited afterward, which reads as "grounded"
  // under a citation-relative check but is exactly the same lie. So this
  // ignores citation order and citation entirely: any write, destructive, or
  // code-execution call that fails, with no LATER call succeeding anywhere in
  // the turn, leaves that attempt uncorrected regardless of what the answer
  // claims or cites. A failed read is exempt - re-checking something
  // incidental and having that check fail says nothing about whether the
  // claimed outcome holds. That exemption is per-call, not per-tool: a
  // composite tool like manage-role exposes read actions (list, get)
  // alongside destructive ones (create, delete) under one tool-level risk
  // class, so a failed list must not be treated as an uncorrected write just
  // because the tool it belongs to can also destroy things.
  //
  // "Later call" means the same tool AND the same input: matching on the
  // action field alone is not enough, because a composite tool's action still
  // covers many different targets - a failed manage-role create for one role
  // is not corrected by a later create for a different one. Requiring the
  // full input to match is the only generic, per-tool-agnostic way to tell
  // "this exact operation was retried" from "a similarly-shaped one ran."
  // The cost is real: a retry that adjusts its input to fix what the first
  // attempt got wrong no longer counts as correcting it, so that turn is
  // rejected rather than credited. That is the intended trade - an honest
  // failure over a claim this check cannot actually verify - not an
  // oversight; loosening it is what created every earlier version of this
  // gap.
  const uncorrectedFailure = toolEvents.find(
    (event, index) =>
      !event.success &&
      !event.readOnly &&
      !toolEvents
        .slice(index + 1)
        .some(
          (later) =>
            later.success &&
            later.toolId === event.toolId &&
            later.inputKey === event.inputKey,
        ),
  );
  if (uncorrectedFailure !== undefined) {
    throw new Error(
      `Turn reported completion, but ${uncorrectedFailure.toolId} failed and was never retried successfully this turn`,
    );
  }
  // Checking the global success set is not enough: a harmless lookup can
  // succeed while the requested mutation never runs, and an answer citing
  // nothing would still pass. Only "supported" work must cite at least one
  // call - conversation and unsupported outcomes are allowed to cite
  // nothing, and every cited call is already known to have succeeded by the
  // check above.
  if (answer.disposition !== "supported") {
    return;
  }
  if (answer.reliedOnToolCallIds.length === 0) {
    throw new Error(
      "Answer claims supported work without citing a successful tool call",
    );
  }
  // Citing a successful call proves only that SOME call succeeded, not that
  // it is the one the answer's claim actually describes: a model could cite
  // a harmless, unrelated read while claiming an unrelated mutation
  // happened, and every check above would still pass. performedMutation is a
  // second, independent self-report that must agree with the citations - a
  // true mutation claim has to be backed by an actually non-read cited call.
  // A model dishonest enough to misreport performedMutation itself is not
  // caught by this, but that is a narrower, less likely failure than citing
  // any convenient success: it requires contradicting the answer's own text.
  if (
    answer.performedMutation &&
    !toolEvents.some(
      (event) =>
        event.success &&
        !event.readOnly &&
        answer.reliedOnToolCallIds.includes(event.toolCallId),
    )
  ) {
    throw new Error(
      "Answer claims a mutation happened, but cites no successful non-read tool call",
    );
  }
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
        abortSignal: AbortSignal.timeout(
          options.timeoutMs ?? config.agent.responseTimeoutMs,
        ),
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
