import type { Job } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { completeJob, failJob } from "./index.ts";
import { sendChatReply } from "@shepherdjerred/sentinel/discord/chat.ts";
import { sendJobNotification } from "@shepherdjerred/sentinel/discord/notifications.ts";
import type { ConversationLogger } from "@shepherdjerred/sentinel/history/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import type { ModelUsageEntry } from "@shepherdjerred/sentinel/types/history.ts";

const workerLogger = logger.child({ module: "worker" });

export type HandleResultContext = {
  job: Job;
  sessionId: string;
  conversationLog: ConversationLogger;
  prisma: PrismaClient;
  systemPrompt: string;
};

export async function handleResult(
  message: SDKResultMessage,
  ctx: HandleResultContext,
  totalInputTokens: number,
  totalOutputTokens: number,
): Promise<void> {
  const { job, sessionId, conversationLog, prisma, systemPrompt } = ctx;
  const isSuccess = message.subtype === "success";
  const outcome = isSuccess ? "completed" : "failed";

  const modelUsage: Record<string, ModelUsageEntry> = {};
  for (const [modelId, usage] of Object.entries(message.modelUsage)) {
    modelUsage[modelId] = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      costUsd: usage.costUSD,
    };
  }

  const permissionDenials = message.permission_denials.map((d) => ({
    toolName: d.tool_name,
    toolInput: JSON.stringify(d.tool_input),
  }));

  await conversationLog.writeSummary({
    totalTurns: message.num_turns,
    totalInputTokens,
    totalOutputTokens,
    durationMs: message.duration_ms,
    outcome,
    totalCostUsd: message.total_cost_usd,
    durationApiMs: message.duration_api_ms,
    modelUsage,
    permissionDenials,
    systemPrompt,
  });

  if (message.subtype === "success") {
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        turnsUsed: message.num_turns,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        status: "completed",
        error: null,
      },
    });

    const resultText = message.result;
    const updatedJob = await completeJob(job.id, resultText);
    workerLogger.info(
      {
        jobId: job.id,
        turns: message.num_turns,
        cost: message.total_cost_usd,
        apiDurationMs: message.duration_api_ms,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        permissionDenials: permissionDenials.length,
      },
      "Job completed successfully",
    );
    await sendJobNotification(updatedJob, resultText);

    if (job.triggerSource === "dm") {
      await sendChatReply(job, resultText, message.session_id);
    }
  } else {
    const errorMsg = message.errors.join("; ");

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        turnsUsed: message.num_turns,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        status: "failed",
        error: errorMsg,
      },
    });

    const updatedJob = await failJob(job.id, errorMsg);
    workerLogger.warn(
      { jobId: job.id, subtype: message.subtype, cost: message.total_cost_usd },
      "Job failed",
    );
    await sendJobNotification(updatedJob, errorMsg);

    if (job.triggerSource === "dm") {
      await sendChatReply(job, errorMsg, null);
    }
  }
}
