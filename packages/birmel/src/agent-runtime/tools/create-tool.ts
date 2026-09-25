import { z } from "zod";
import type { BirmelToolMetadata } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import {
  getRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  getToolMetadata,
  toolRequiresExternalEffectCheckpoint,
} from "./tool-metadata.ts";

const logger = loggers.tools.child("ai-sdk");

type BirmelToolOptions<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
> = {
  id: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  preflight?: (
    input: z.infer<InputSchema>,
    context: BirmelToolExecutionContext,
  ) =>
    | Promise<z.infer<OutputSchema> | undefined>
    | z.infer<OutputSchema>
    | undefined;
  execute: (
    input: z.infer<InputSchema>,
    context: BirmelToolExecutionContext,
  ) => Promise<z.infer<OutputSchema>> | z.infer<OutputSchema>;
};

export type BirmelToolExecutionContext = {
  signal: AbortSignal;
};

export type BirmelTool<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
> = {
  id: string;
  type: "function";
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  birmelMetadata: BirmelToolMetadata;
  metadata: BirmelToolMetadata;
  execute: (
    input: z.output<InputSchema>,
    executionOptions?: unknown,
  ) => PromiseLike<z.output<OutputSchema>> | z.output<OutputSchema>;
};

type InternalToolExecution = {
  preflight: (input: unknown, executionOptions?: unknown) => Promise<unknown>;
  executeAfterPreflight: (
    input: unknown,
    executionOptions?: unknown,
  ) => Promise<unknown>;
};

const internalToolExecutions = new WeakMap<object, InternalToolExecution>();

function requireInternalToolExecution(tool: object): InternalToolExecution {
  const execution = internalToolExecutions.get(tool);
  if (execution == null) {
    throw new Error("Tool was not created by the Birmel runtime");
  }
  return execution;
}

export async function preflightCreatedTool(
  tool: object,
  input: unknown,
  executionOptions?: unknown,
): Promise<unknown> {
  return await requireInternalToolExecution(tool).preflight(
    input,
    executionOptions,
  );
}

export async function executeCreatedToolAfterPreflight(
  tool: object,
  input: unknown,
  executionOptions?: unknown,
): Promise<unknown> {
  return await requireInternalToolExecution(tool).executeAfterPreflight(
    input,
    executionOptions,
  );
}

const ObjectInputSchema = z.record(z.string(), z.unknown());
const ToolExecutionOptionsSchema = z
  .object({ abortSignal: z.instanceof(AbortSignal).optional() })
  .loose();

function requireTrustedContext(): RequestContext {
  const context = getRequestContext();
  if (context == null) {
    throw new Error("Birmel tool executed without trusted request context");
  }
  if (!getConfig().authority.trustedUserIds.includes(context.userId)) {
    throw new Error("Birmel tool actor is not trusted");
  }
  return context;
}

function deriveGuildFromRuntime(input: unknown, context: RequestContext) {
  const objectInput = ObjectInputSchema.safeParse(input);
  if (!objectInput.success) {
    return input;
  }
  return {
    ...objectInput.data,
    guildId: context.guildId,
  };
}

function enforceSingleRuntimeReply(
  toolId: string,
  input: unknown,
  context: RequestContext,
): void {
  if (toolId !== "manage-message" || !context.ownsSourceReply) {
    return;
  }
  const parsed = ObjectInputSchema.safeParse(input);
  if (!parsed.success) {
    return;
  }
  const action = parsed.data["action"];
  const channelId = parsed.data["channelId"];
  if (
    action === "reply" ||
    (action === "send" && channelId === context.sourceChannelId)
  ) {
    throw new Error(
      "The runtime owns the single source-channel reply; use manage-message only for another channel or DM",
    );
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Tool execution aborted", "AbortError");
}

async function withCancellation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): Promise<T> {
  const controller = new AbortController();
  const forwardCallerAbort = () => {
    controller.abort(
      callerSignal == null ? undefined : abortReason(callerSignal),
    );
  };
  if (callerSignal?.aborted === true) {
    forwardCallerAbort();
  } else {
    callerSignal?.addEventListener("abort", forwardCallerAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(`Tool execution timed out after ${String(timeoutMs)}ms`),
    );
  }, timeoutMs);
  try {
    controller.signal.throwIfAborted();
    try {
      const result = await operation(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw abortReason(controller.signal);
      }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", forwardCallerAbort);
  }
}

export function createTool<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(
  options: BirmelToolOptions<InputSchema, OutputSchema>,
): BirmelTool<InputSchema, OutputSchema> {
  const metadata = getToolMetadata(options.id);
  const executeWithMode = async (
    untrustedInput: unknown,
    untrustedExecutionOptions?: unknown,
    mode: "full" | "after-preflight" = "full",
  ) => {
    const requestContext = requireTrustedContext();
    enforceSingleRuntimeReply(options.id, untrustedInput, requestContext);
    const input = options.inputSchema.parse(
      deriveGuildFromRuntime(untrustedInput, requestContext),
    );
    const executionOptions =
      untrustedExecutionOptions == null
        ? undefined
        : ToolExecutionOptionsSchema.parse(untrustedExecutionOptions);
    return await withSpan(
      "birmel.tool.execute",
      {
        operation: `tool.${metadata.id}`,
      },
      async (span) => {
        const startedAt = performance.now();
        try {
          const output = await withCancellation(
            async (signal) => {
              signal.throwIfAborted();
              if (mode === "full") {
                const preflightOutput = await options.preflight?.(input, {
                  signal,
                });
                if (preflightOutput !== undefined) {
                  return preflightOutput;
                }
                if (toolRequiresExternalEffectCheckpoint(metadata.id, input)) {
                  await requestContext.beforeExternalEffect?.();
                }
              }
              const result = await options.execute(input, { signal });
              signal.throwIfAborted();
              return result;
            },
            metadata.timeoutMs,
            executionOptions?.abortSignal,
          );
          const validatedOutput = options.outputSchema.parse(output);
          span.setAttribute("tool.success", true);
          span.setAttribute("tool.duration_ms", performance.now() - startedAt);
          logger.info("Birmel tool call completed", {
            toolId: metadata.id,
            riskClass: metadata.riskClass,
            durationMs: performance.now() - startedAt,
          });
          return validatedOutput;
        } catch (error) {
          span.setAttribute("tool.success", false);
          span.setAttribute(
            "tool.error_class",
            error instanceof Error ? error.name : "UnknownError",
          );
          logger.error("Birmel tool call failed", error, {
            toolId: metadata.id,
            riskClass: metadata.riskClass,
            errorClass: error instanceof Error ? error.name : "UnknownError",
          });
          throw error;
        }
      },
    );
  };
  const preflight = async (
    untrustedInput: unknown,
    untrustedExecutionOptions?: unknown,
  ) => {
    const requestContext = requireTrustedContext();
    enforceSingleRuntimeReply(options.id, untrustedInput, requestContext);
    const input = options.inputSchema.parse(
      deriveGuildFromRuntime(untrustedInput, requestContext),
    );
    const executionOptions =
      untrustedExecutionOptions == null
        ? undefined
        : ToolExecutionOptionsSchema.parse(untrustedExecutionOptions);
    return await withCancellation(
      async (signal) => {
        const output = await options.preflight?.(input, { signal });
        return output === undefined
          ? undefined
          : options.outputSchema.parse(output);
      },
      metadata.timeoutMs,
      executionOptions?.abortSignal,
    );
  };
  const execute = async (
    untrustedInput: unknown,
    untrustedExecutionOptions?: unknown,
  ) => await executeWithMode(untrustedInput, untrustedExecutionOptions, "full");
  const executeAfterPreflight = async (
    untrustedInput: unknown,
    untrustedExecutionOptions?: unknown,
  ) =>
    await executeWithMode(
      untrustedInput,
      untrustedExecutionOptions,
      "after-preflight",
    );

  const tool: BirmelTool<InputSchema, OutputSchema> = {
    id: options.id,
    type: "function",
    description: options.description,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    metadata,
    birmelMetadata: metadata,
    execute,
  };
  internalToolExecutions.set(tool, { preflight, executeAfterPreflight });
  return tool;
}
