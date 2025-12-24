import type { ScheduledTask } from "@prisma/client";
import { prisma } from "../../database/index.js";
import { loggers } from "../../utils/index.js";
import { allTools } from "../../mastra/tools/index.js";
import { getNextCronRun } from "../utils/cron.js";

const logger = loggers.scheduler;

/**
 * Execute a single scheduled task
 */
async function executeScheduledTask(task: ScheduledTask): Promise<void> {
  try {
    logger.info("Executing scheduled task", {
      id: task.id,
      guildId: task.guildId,
      toolId: task.toolId,
      name: task.name,
    });

    // If no toolId specified, this is just a reminder (no action)
    if (!task.toolId) {
      logger.info("Task has no toolId (reminder only)", { id: task.id });
      await markTaskExecuted(task);
      return;
    }

    // Get the tool
    const tool = allTools[task.toolId];
    if (!tool) {
      logger.error("Tool not found", {
        taskId: task.id,
        toolId: task.toolId,
      });
      await markTaskExecuted(task); // Mark as executed even if tool missing
      return;
    }

    // Parse tool input
    let toolInput: Record<string, unknown> = {};
    if (task.toolInput) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        toolInput = JSON.parse(task.toolInput);
      } catch (error) {
        logger.error("Failed to parse tool input", {
          taskId: task.id,
          toolInput: task.toolInput,
          error: String(error),
        });
        await markTaskExecuted(task);
        return;
      }
    }

    // Execute the tool
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await (tool as any).execute(toolInput, {
      runId: `scheduled-task-${String(task.id)}`,
      agentId: "birmel",
    });

    logger.info("Scheduled task executed successfully", {
      id: task.id,
      toolId: task.toolId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      success: result.success ?? true,
    });

    // Mark as executed
    await markTaskExecuted(task);

    // If recurring, schedule the next run
    if (task.cronPattern) {
      await scheduleNextRun(task);
    }
  } catch (error) {
    logger.error("Failed to execute scheduled task", {
      taskId: task.id,
      error: String(error),
    });

    // Still mark as executed to avoid retry loops
    await markTaskExecuted(task);
  }
}

/**
 * Mark a task as executed
 */
async function markTaskExecuted(task: ScheduledTask): Promise<void> {
  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: { executedAt: new Date() },
  });
}

/**
 * Schedule the next run for a recurring task
 */
async function scheduleNextRun(task: ScheduledTask): Promise<void> {
  if (!task.cronPattern) {
    return;
  }

  try {
    const nextRun = getNextCronRun(task.cronPattern, new Date());

    // Create a new task for the next run
    await prisma.scheduledTask.create({
      data: {
        guildId: task.guildId,
        channelId: task.channelId,
        userId: task.userId,
        scheduledAt: nextRun,
        cronPattern: task.cronPattern,
        naturalDesc: task.naturalDesc,
        toolId: task.toolId,
        toolInput: task.toolInput,
        enabled: task.enabled,
        name: task.name,
        description: task.description,
        nextRun,
      },
    });

    logger.info("Scheduled next recurring task run", {
      originalTaskId: task.id,
      nextRun: nextRun.toISOString(),
      cronPattern: task.cronPattern,
    });
  } catch (error) {
    logger.error("Failed to schedule next recurring task run", {
      taskId: task.id,
      cronPattern: task.cronPattern,
      error: String(error),
    });
  }
}

/**
 * Run the scheduled tasks job - checks for and executes due tasks
 */
export async function runScheduledTasksJob(): Promise<void> {
  try {
    // Find tasks that are due and haven't been executed yet
    const dueTasks = await prisma.scheduledTask.findMany({
      where: {
        enabled: true,
        executedAt: null,
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
    });

    if (dueTasks.length === 0) {
      return;
    }

    logger.info("Processing due scheduled tasks", {
      count: dueTasks.length,
    });

    // Execute all due tasks
    for (const task of dueTasks) {
      await executeScheduledTask(task);
    }
  } catch (error) {
    logger.error("Scheduled tasks job failed", {
      error: String(error),
    });
  }
}
