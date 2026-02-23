import type { Job } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import {
  type JobPriority,
  PRIORITY_MAP,
} from "@shepherdjerred/sentinel/types/job.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { getConfig } from "@shepherdjerred/sentinel/config/index.ts";

const queueLogger = logger.child({ module: "queue" });

export type EnqueueJobParams = {
  agent: string;
  prompt: string;
  triggerType: string;
  triggerSource: string;
  priority?: JobPriority;
  deduplicationKey?: string;
  deadlineAt?: Date;
  maxRetries?: number;
  triggerMetadata?: Record<string, unknown>;
};

export async function enqueueJob(params: EnqueueJobParams): Promise<Job> {
  const prisma = getPrisma();
  const config = getConfig();

  if (params.deduplicationKey != null) {
    const existing = await prisma.job.findUnique({
      where: { deduplicationKey: params.deduplicationKey },
    });
    if (existing != null) {
      queueLogger.info(
        {
          deduplicationKey: params.deduplicationKey,
          existingJobId: existing.id,
        },
        "Duplicate job skipped",
      );
      return existing;
    }
  }

  try {
    const job = await prisma.job.create({
      data: {
        agent: params.agent,
        prompt: params.prompt,
        priority: PRIORITY_MAP[params.priority ?? "normal"],
        triggerType: params.triggerType,
        triggerSource: params.triggerSource,
        triggerMetadata: JSON.stringify(params.triggerMetadata ?? {}),
        deduplicationKey: params.deduplicationKey ?? null,
        deadlineAt: params.deadlineAt ?? null,
        maxRetries: params.maxRetries ?? config.queue.defaultMaxRetries,
      },
    });

    queueLogger.info(
      {
        jobId: job.id,
        agent: params.agent,
        triggerType: params.triggerType,
        priority: job.priority,
      },
      "Job enqueued",
    );
    return job;
  } catch (error) {
    // Handle P2002 unique constraint race on deduplicationKey
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      params.deduplicationKey != null
    ) {
      const existing = await prisma.job.findUniqueOrThrow({
        where: { deduplicationKey: params.deduplicationKey },
      });
      queueLogger.info(
        {
          deduplicationKey: params.deduplicationKey,
          existingJobId: existing.id,
        },
        "Duplicate job skipped (race)",
      );
      return existing;
    }
    throw error;
  }
}

export async function claimJob(): Promise<Job | null> {
  const prisma = getPrisma();
  const now = new Date();

  // Cancel any expired pending jobs first, then claim the next valid one
  const job = await prisma.$transaction(async (tx) => {
    // Batch-cancel all expired pending jobs so they don't block the queue
    const cancelled = await tx.job.updateMany({
      where: {
        status: "pending",
        deadlineAt: { not: null, lt: now },
      },
      data: { status: "cancelled", completedAt: now },
    });
    if (cancelled.count > 0) {
      queueLogger.info(
        { count: cancelled.count },
        "Cancelled expired jobs",
      );
    }

    // Find the highest-priority non-expired pending job
    const pending = await tx.job.findFirst({
      where: {
        status: "pending",
        OR: [{ deadlineAt: null }, { deadlineAt: { gte: now } }],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    if (pending == null) {
      return null;
    }

    return tx.job.update({
      where: { id: pending.id, status: "pending" },
      data: { status: "running", claimedAt: now },
    });
  });

  if (job != null) {
    queueLogger.info({ jobId: job.id, agent: job.agent }, "Job claimed");
  }

  return job;
}

export async function completeJob(id: string, result: string): Promise<Job> {
  const prisma = getPrisma();
  const job = await prisma.job.update({
    where: { id },
    data: {
      status: "completed",
      completedAt: new Date(),
      result,
    },
  });
  queueLogger.info({ jobId: id }, "Job completed");
  return job;
}

export async function failJob(id: string, error: string): Promise<Job> {
  const prisma = getPrisma();

  const current = await prisma.job.findUniqueOrThrow({ where: { id } });

  if (current.retryCount < current.maxRetries) {
    const job = await prisma.job.update({
      where: { id },
      data: {
        status: "pending",
        retryCount: current.retryCount + 1,
        claimedAt: null,
      },
    });
    queueLogger.info(
      { jobId: id, retryCount: job.retryCount, maxRetries: job.maxRetries },
      "Job requeued for retry",
    );
    return job;
  }

  const job = await prisma.job.update({
    where: { id },
    data: {
      status: "failed",
      completedAt: new Date(),
      result: error,
    },
  });
  queueLogger.info({ jobId: id }, "Job failed permanently");
  return job;
}

export async function recoverStaleJobs(): Promise<number> {
  const prisma = getPrisma();
  const config = getConfig();
  const staleThreshold = new Date(Date.now() - config.queue.maxJobDurationMs);

  const staleJobs = await prisma.job.findMany({
    where: {
      status: "running",
      claimedAt: { lt: staleThreshold },
    },
  });

  let recovered = 0;
  for (const job of staleJobs) {
    await (job.retryCount < job.maxRetries
      ? prisma.job.update({
          where: { id: job.id },
          data: {
            status: "pending",
            retryCount: job.retryCount + 1,
            claimedAt: null,
          },
        })
      : prisma.job.update({
          where: { id: job.id },
          data: {
            status: "failed",
            completedAt: new Date(),
            result: "Stale job recovery: exceeded max retries",
          },
        }));
    recovered++;
  }

  if (recovered > 0) {
    queueLogger.info({ recovered }, "Recovered stale jobs");
  }
  return recovered;
}

export type QueueStats = {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  awaitingApproval: number;
};

export async function getQueueStats(): Promise<QueueStats> {
  const prisma = getPrisma();
  const counts = await prisma.job.groupBy({
    by: ["status"],
    _count: { status: true },
  });

  const stats: QueueStats = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    awaitingApproval: 0,
  };

  for (const row of counts) {
    switch (row.status) {
      case "pending": {
        stats.pending = row._count.status;
        break;
      }
      case "running": {
        stats.running = row._count.status;
        break;
      }
      case "completed": {
        stats.completed = row._count.status;
        break;
      }
      case "failed": {
        stats.failed = row._count.status;
        break;
      }
      case "cancelled": {
        stats.cancelled = row._count.status;
        break;
      }
      case "awaiting_approval": {
        stats.awaitingApproval = row._count.status;
        break;
      }
      default: {
        queueLogger.warn(
          { status: row.status, count: row._count.status },
          "Unknown job status in queue stats",
        );
      }
    }
  }

  return stats;
}
