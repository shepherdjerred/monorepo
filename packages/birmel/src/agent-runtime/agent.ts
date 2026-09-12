import { Output, stepCountIs, ToolLoopAgent } from "ai";
import { redactSecrets } from "@shepherdjerred/llm-observability";
import { z } from "zod";
import {
  CookieEntrySchema,
  CREDENTIAL_KEY_PATTERN,
  DISCORD_SENSITIVE_URL_PATTERN,
  InviteEntrySchema,
  redactInviteFields,
  type SessionToolEvent,
  SessionToolEventSchema,
  type TaskPacket,
  TaskPacketSchema,
  ToolDomainResultSchema,
  ToolIdSchema,
  ToolResultForSessionSchema,
  TurnAnswerSchema,
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
import {
  requireGroundedAnswer,
  withResolvedCitations,
} from "./citation-repair.ts";

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
  progress?: ProgressReporter | undefined;
};

export type IsolatedAgentOptions = {
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  textVerbosity?: "low" | "medium" | "high";
  timeoutMs?: number;
};

const logger = loggers.agent.child("execution");

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

type SanitizeToolOutputOptions = {
  isCookiesCall: boolean;
  isInviteCall: boolean;
  isShellCall: boolean;
  isBrowserCall: boolean;
  isWebContentCall: boolean;
  isDiscordMessageCall: boolean;
};

function sanitizeArrayEntry(
  entry: unknown,
  options: SanitizeToolOutputOptions,
): unknown {
  const cookie = CookieEntrySchema.safeParse(entry);
  if (cookie.success) {
    return sanitizeToolOutputData(
      { ...cookie.data, value: "[REDACTED]" },
      options,
    );
  }
  if (
    entry !== null &&
    typeof entry === "object" &&
    (options.isInviteCall || InviteEntrySchema.safeParse(entry).success)
  ) {
    return sanitizeToolOutputData(redactInviteFields(entry), options);
  }
  return sanitizeToolOutputData(entry, options);
}

function sanitizeObjectEntry(
  key: string,
  value: unknown,
  options: SanitizeToolOutputOptions,
): unknown {
  if (CREDENTIAL_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (options.isInviteCall && (key === "code" || key === "url")) {
    return value == null ? value : "[REDACTED]";
  }
  const cookie = CookieEntrySchema.safeParse(value);
  if (cookie.success) {
    return sanitizeToolOutputData(
      { ...cookie.data, value: "[REDACTED]" },
      options,
    );
  }
  const invite = InviteEntrySchema.safeParse(value);
  if (invite.success) {
    return sanitizeToolOutputData(redactInviteFields(invite.data), options);
  }
  return sanitizeToolOutputData(value, options);
}

const WEB_CONTENT_OMITTED_KEYS = new Set([
  "content",
  "summary",
  "text",
  "html",
  "raw",
  "snippet",
  "title",
]);

function shouldOmitOutputKey(
  key: string,
  options: SanitizeToolOutputOptions,
): boolean {
  if (key === "raw" && (options.isCookiesCall || options.isBrowserCall)) {
    return true;
  }
  if (key === "text" && options.isBrowserCall) {
    return true;
  }
  if ((key === "stdout" || key === "stderr") && options.isShellCall) {
    return true;
  }
  if (key === "content" && options.isDiscordMessageCall) {
    return true;
  }
  return options.isWebContentCall && WEB_CONTENT_OMITTED_KEYS.has(key);
}

function sanitizeToolOutputData(
  data: unknown,
  options: SanitizeToolOutputOptions,
): unknown {
  if (typeof data === "string") {
    return data.replaceAll(DISCORD_SENSITIVE_URL_PATTERN, "[REDACTED]");
  }
  if (data === null || typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((entry) => sanitizeArrayEntry(entry, options));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (shouldOmitOutputKey(key, options)) {
      continue;
    }
    sanitized[key] = sanitizeObjectEntry(key, value, options);
  }
  return sanitized;
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
  const action = ActionInputSchema.safeParse(toolResult.input);
  const isCookiesCall = action.success && action.data.action === "cookies";
  const isInviteCall = toolResult.toolName === "manage-invite";
  const isShellCall = toolResult.toolName === "execute-shell-command";
  const isBrowserCall = toolResult.toolName === "browser-automation";
  const isWebContentCall =
    toolResult.toolName === "web-research" ||
    toolResult.toolName === "external-service";
  const isDiscordMessageCall =
    toolResult.toolName === "manage-message" ||
    toolResult.toolName === "manage-thread";
  const inputSummary = boundedSummary(toolResult.input);
  const sanitizedData =
    toolResult.output.data === undefined
      ? undefined
      : sanitizeToolOutputData(toolResult.output.data, {
          isCookiesCall,
          isInviteCall,
          isShellCall,
          isBrowserCall,
          isWebContentCall,
          isDiscordMessageCall,
        });
  const hasData =
    sanitizedData !== undefined &&
    sanitizedData !== null &&
    (typeof sanitizedData !== "object" ||
      (Array.isArray(sanitizedData)
        ? sanitizedData.length > 0
        : Object.keys(sanitizedData).length > 0));
  const resultSummary = toolResult.output.success
    ? boundedSummary(
        hasData
          ? {
              message: toolResult.output.message,
              data: sanitizedData,
            }
          : toolResult.output.message,
      )
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
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      const answer = withResolvedCitations(
        TurnAnswerSchema.parse(result.output),
        toolEvents,
      );
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
