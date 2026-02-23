import type { Job } from "@prisma/client";
import { claimJob, completeJob, failJob, recoverStaleJobs } from "./index.ts";
import { getAgent } from "@shepherdjerred/sentinel/agents/registry.ts";
import { getConfig } from "@shepherdjerred/sentinel/config/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

const workerLogger = logger.child({ module: "worker" });

let running = false;
let currentJob: Job | null = null;

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

  // Wait for current job to finish by polling
  while (getCurrentJob() != null) {
    workerLogger.info("Waiting for current job to finish");
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  workerLogger.info("Worker stopped");
}

function getCurrentJob(): Job | null {
  return currentJob;
}

async function runLoop(): Promise<void> {
  const config = getConfig();

  // Recover stale jobs on startup
  await recoverStaleJobs();

  while (running) {
    try {
      const job = await claimJob();

      if (job == null) {
        await new Promise((resolve) => {
          setTimeout(resolve, config.queue.pollIntervalMs);
        });
        continue;
      }

      currentJob = job;
      try {
        await processJob(job);
      } finally {
        currentJob = null;
      }
    } catch (error) {
      workerLogger.error(error, "Worker loop error");
      // Brief pause before retrying the loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
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

  try {
    // Phase 2 stub: log and mark complete
    // In Phase 3, this will be replaced with Agent SDK execution
    workerLogger.info(
      {
        jobId: job.id,
        agent: agentDef.name,
        prompt: job.prompt.slice(0, 200),
      },
      "Would process job (Phase 2 stub)",
    );

    await completeJob(job.id, "Phase 2 stub: job processed successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    workerLogger.error(
      { jobId: job.id, error: message },
      "Job processing failed",
    );
    await failJob(job.id, message);
  }
}
