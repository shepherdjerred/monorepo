import { z } from "zod";
import type { RequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";

/**
 * The per-run identity and context a scheduled job executes against. Shared
 * rather than owned by the executor so session recording and delivery can
 * describe the same run without importing the executor back.
 */
export type AgentJobExecution = {
  jobId: string;
  runId: string;
  claimId: string;
  guildId: string;
  actorUserId: string;
  sessionId: string | null;
  model: string | null;
  reasoningEffort: string | null;
  textVerbosity: string | null;
  timeoutMs: number;
  requestContext: RequestContext;
};

export type AgentJobRuntimeDependencies = {
  executeTool: (
    toolId: string,
    input: Record<string, unknown>,
    execution: AgentJobExecution,
  ) => Promise<unknown>;
  executeAgent: (
    prompt: string,
    execution: AgentJobExecution,
  ) => Promise<unknown>;
  deliverMessage: (
    channelId: string,
    message: string,
    execution: AgentJobExecution,
  ) => Promise<unknown>;
};

/**
 * Whether a job's external effect definitely landed, definitely did not, or
 * cannot be determined. "unknown" is what pauses a job for operator review
 * rather than risking a duplicate post.
 */
export const EffectDispositionSchema = z.enum([
  "not_applied",
  "applied",
  "unknown",
]);

export const DeliveryResultSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
    data: z.object({ messageId: z.string().min(1) }).optional(),
    effectDisposition: EffectDispositionSchema.optional(),
  })
  .loose();
