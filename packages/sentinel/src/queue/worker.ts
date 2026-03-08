import type { Job } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claimJob, completeJob, failJob, recoverStaleJobs } from "./index.ts";
import { getAgent } from "@shepherdjerred/sentinel/agents/registry.ts";
import { getConfig } from "@shepherdjerred/sentinel/config/index.ts";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import { sendChatReply } from "@shepherdjerred/sentinel/discord/chat.ts";
import { sendJobNotification } from "@shepherdjerred/sentinel/discord/notifications.ts";
import type { ConversationLogger } from "@shepherdjerred/sentinel/history/index.ts";
import { createConversationLogger } from "@shepherdjerred/sentinel/history/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { buildMemoryContext } from "@shepherdjerred/sentinel/memory/context.ts";
import { buildPermissionHandler } from "@shepherdjerred/sentinel/permissions/index.ts";
import { emitSSE } from "@shepherdjerred/sentinel/sse/index.ts";
import type { ModelUsageEntry } from "@shepherdjerred/sentinel/types/history.ts";

const workerLogger = logger.child({ module: "worker" });
const STALE_RECOVERY_INTERVAL_MS = 60_000;

// Env vars that must be stripped when spawning Claude Code subprocesses
// to avoid "cannot be launched inside another Claude Code session" errors
const CLAUDE_SESSION_VARS = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
]);

function buildAgentEnv(apiKey: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value != null && !CLAUDE_SESSION_VARS.has(key)) {
      env[key] = value;
    }
  }
  env["ANTHROPIC_API_KEY"] = apiKey;
  return env;
}

let running = false;
const activeJobs = new Map<string, Promise<void>>();

export function startWorker(): void {
  if (running) {
    workerLogger.warn("Worker already running");
    return;
  }
  running = true;
  workerLogger.info("Worker started");
  void runLoop();
}

export async function stopWorker(): Promise<void> {
  workerLogger.info("Stopping worker...");
  running = false;

  // Wait for all active jobs to finish
  while (activeJobs.size > 0) {
    workerLogger.info(
      { activeJobs: activeJobs.size },
      "Waiting for active jobs to finish",
    );
    await Promise.race(activeJobs.values()).catch(() => {
      // Ignore errors — they're handled inside processJob
    });
  }

  workerLogger.info("Worker stopped");
}

async function runLoop(): Promise<void> {
  const config = getConfig();
  const maxConcurrent = config.queue.maxConcurrentJobs;

  // Recover stale jobs on startup
  await recoverStaleJobs();
  let lastRecoveryTime = Date.now();

  while (running) {
    try {
      // Periodically recover stale jobs (not just at startup)
      const now = Date.now();
      if (now - lastRecoveryTime >= STALE_RECOVERY_INTERVAL_MS) {
        await recoverStaleJobs();
        lastRecoveryTime = now;
      }

      // If at capacity, wait for any job to finish before claiming more
      if (activeJobs.size >= maxConcurrent) {
        await Promise.race(activeJobs.values()).catch(() => {
          // Ignore errors — they're handled inside processJob
        });
        continue;
      }

      const job = await claimJob();

      if (job == null) {
        await new Promise((resolve) => {
          setTimeout(resolve, config.queue.pollIntervalMs);
        });
        continue;
      }

      // Run job concurrently — don't await
      const jobPromise = (async () => {
        try {
          await processJob(job);
        } finally {
          activeJobs.delete(job.id);
        }
      })();
      activeJobs.set(job.id, jobPromise);
    } catch (error) {
      workerLogger.error(error, "Worker loop error");
      // Brief pause before retrying the loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
  }
}

type TurnContext = {
  sessionId: string;
  agent: string;
  jobId: string;
  turnNumber: number;
  model: string;
  tokenUsage: { input: number; output: number };
};

async function logAssistantTurn(
  betaMessage: {
    content: {
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      id?: string;
    }[];
  },
  conversationLog: ConversationLogger,
  ctx: TurnContext,
): Promise<void> {
  const textParts: string[] = [];
  for (const block of betaMessage.content) {
    if (block.type === "text" && block.text != null) {
      textParts.push(block.text);
    }
  }

  await conversationLog.appendEntry({
    timestamp: new Date().toISOString(),
    sessionId: ctx.sessionId,
    agent: ctx.agent,
    jobId: ctx.jobId,
    role: "assistant",
    content: textParts.join("\n"),
    turnNumber: ctx.turnNumber,
    model: ctx.model,
    tokenUsage: ctx.tokenUsage,
  });

  for (const block of betaMessage.content) {
    if (block.type === "tool_use" && block.name != null && block.id != null) {
      await conversationLog.appendEntry({
        timestamp: new Date().toISOString(),
        sessionId: ctx.sessionId,
        agent: ctx.agent,
        jobId: ctx.jobId,
        role: "tool_use",
        content: "",
        toolName: block.name,
        toolInput: JSON.stringify(block.input),
        toolUseId: block.id,
        turnNumber: ctx.turnNumber,
        model: ctx.model,
      });
    }
  }
}

async function processJob(job: Job): Promise<void> {
  const agentDef = getAgent(job.agent);

  if (agentDef == null) {
    workerLogger.error({ agent: job.agent, jobId: job.id }, "Unknown agent");
    await failJob(job.id, `Unknown agent: ${job.agent}`);
    return;
  }

  workerLogger.info(
    {
      jobId: job.id,
      agent: job.agent,
      priority: job.priority,
      retryCount: job.retryCount,
    },
    "Processing job",
  );

  const config = getConfig();
  const prisma = getPrisma();
  const sessionId = crypto.randomUUID();

  await prisma.agentSession.create({
    data: { id: sessionId, agent: job.agent, jobId: job.id },
  });

  const conversationLog = createConversationLogger(
    job.agent,
    job.id,
    sessionId,
  );

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, config.queue.maxJobDurationMs);

  let turnCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    const memoryContext = await buildMemoryContext(agentDef, job.prompt);
    const systemPrompt =
      memoryContext.length > 0
        ? `${agentDef.systemPrompt}\n\n${memoryContext}`
        : agentDef.systemPrompt;

    // Log the system prompt as the first conversation entry
    await conversationLog.appendEntry({
      timestamp: new Date().toISOString(),
      sessionId,
      agent: job.agent,
      jobId: job.id,
      role: "system",
      content: systemPrompt,
      turnNumber: 0,
      metadata: { type: "system_prompt" },
    });

    const metadata: unknown = JSON.parse(job.triggerMetadata);
    const metadataObj =
      metadata != null && typeof metadata === "object" ? metadata : {};
    const resumeSessionId =
      "resumeSessionId" in metadataObj &&
      typeof metadataObj.resumeSessionId === "string"
        ? metadataObj.resumeSessionId
        : undefined;

    const agentQuery = query({
      prompt: job.prompt,
      options: {
        model: config.anthropic.model,
        systemPrompt,
        allowedTools: agentDef.tools,
        maxTurns: agentDef.maxTurns,
        canUseTool: buildPermissionHandler(agentDef, sessionId),
        cwd: process.cwd(),
        abortController,
        env: buildAgentEnv(config.anthropic.apiKey),
        permissionMode: "dontAsk",
        stderr: (data: string) => {
          workerLogger.debug(
            { jobId: job.id, stderr: data.trim() },
            "Agent stderr",
          );
        },
        ...(resumeSessionId == null ? {} : { resume: resumeSessionId }),
      },
    });

    for await (const message of agentQuery) {
      switch (message.type) {
        case "assistant": {
          turnCount++;
          const betaMessage = message.message;
          const turnUsage = betaMessage.usage;
          const turnModel = betaMessage.model;

          await logAssistantTurn(betaMessage, conversationLog, {
            sessionId,
            agent: job.agent,
            jobId: job.id,
            turnNumber: turnCount,
            model: turnModel,
            tokenUsage: {
              input: turnUsage.input_tokens,
              output: turnUsage.output_tokens,
            },
          });

          // Live progress: update DB (also bumps updatedAt) and emit SSE
          await prisma.agentSession.update({
            where: { id: sessionId },
            data: { turnsUsed: turnCount },
          });
          emitSSE({
            type: "job:progress",
            jobId: job.id,
            sessionId,
            agent: job.agent,
            turnsUsed: turnCount,
          });
          break;
        }
        case "user": {
          await conversationLog.appendEntry({
            timestamp: new Date().toISOString(),
            sessionId,
            agent: job.agent,
            jobId: job.id,
            role: "tool_result",
            content: JSON.stringify(message.message),
            turnNumber: turnCount,
          });
          break;
        }
        case "result": {
          totalInputTokens = message.usage["input_tokens"];
          totalOutputTokens = message.usage["output_tokens"];
          await handleResult(
            message,
            { job, sessionId, conversationLog, prisma, systemPrompt },
            totalInputTokens,
            totalOutputTokens,
          );
          break;
        }
        case "system": {
          if (message.subtype === "init") {
            await conversationLog.appendEntry({
              timestamp: new Date().toISOString(),
              sessionId,
              agent: job.agent,
              jobId: job.id,
              role: "system",
              content: JSON.stringify({
                model: message.model,
                tools: message.tools,
                mcpServers: message.mcp_servers,
              }),
              turnNumber: 0,
              metadata: { type: "init" },
            });
          }
          break;
        }
        case "stream_event":
        case "tool_progress":
        case "auth_status":
        case "tool_use_summary":
        case "rate_limit_event":
        case "prompt_suggestion": {
          break;
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    workerLogger.error(
      { jobId: job.id, error: message },
      "Job processing failed",
    );

    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        turnsUsed: turnCount,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        status: "failed",
        error: message,
      },
    });

    const updatedJob = await failJob(job.id, message);
    await sendJobNotification(updatedJob, message);

    if (job.triggerSource === "dm") {
      await sendChatReply(job, `Sorry, something went wrong: ${message}`, null);
    }
  } finally {
    clearTimeout(timeout);
  }
}

type HandleResultContext = {
  job: Job;
  sessionId: string;
  conversationLog: ConversationLogger;
  prisma: PrismaClient;
  systemPrompt: string;
};

async function handleResult(
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
