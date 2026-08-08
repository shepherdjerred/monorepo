import type { AgentJob, Prisma } from "#generated/prisma/client/index.js";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";

const TERMINAL_JOB_STATUSES = ["cancelled", "completed", "failed"];

type JobLimitSubject = {
  id?: string;
  guildId: string;
  scheduleKind: string;
  status: string;
};

async function assertAgentJobLimits(
  transaction: Prisma.TransactionClient,
  subject: JobLimitSubject,
): Promise<void> {
  if (TERMINAL_JOB_STATUSES.includes(subject.status)) {
    return;
  }
  const schedulerConfig = getConfig().scheduler;
  const excludeSubject = subject.id == null ? {} : { id: { not: subject.id } };
  const activeGuildJobCount = await transaction.agentJob.count({
    where: {
      guildId: subject.guildId,
      status: { notIn: TERMINAL_JOB_STATUSES },
      ...excludeSubject,
    },
  });
  if (activeGuildJobCount >= schedulerConfig.maxTasksPerGuild) {
    throw new Error(
      `Guild active job limit of ${String(schedulerConfig.maxTasksPerGuild)} reached`,
    );
  }

  if (subject.scheduleKind === "at") {
    return;
  }
  const activeRecurringJobCount = await transaction.agentJob.count({
    where: {
      scheduleKind: { in: ["every", "cron"] },
      status: { notIn: TERMINAL_JOB_STATUSES },
      ...excludeSubject,
    },
  });
  if (activeRecurringJobCount >= schedulerConfig.maxRecurringTasks) {
    throw new Error(
      `Active recurring job limit of ${String(schedulerConfig.maxRecurringTasks)} reached`,
    );
  }
}

export async function createAgentJobWithinLimits(
  data: Prisma.AgentJobUncheckedCreateInput,
): Promise<AgentJob> {
  return await prisma.$transaction(async (transaction) => {
    await assertAgentJobLimits(transaction, {
      guildId: data.guildId,
      scheduleKind: data.scheduleKind,
      status: typeof data.status === "string" ? data.status : "active",
    });
    return await transaction.agentJob.create({ data });
  });
}

export async function updateAgentJobWithinLimits(options: {
  where: Prisma.AgentJobWhereInput;
  data: Prisma.AgentJobUncheckedUpdateManyInput;
  subject: JobLimitSubject;
}): Promise<number> {
  return await prisma.$transaction(async (transaction) => {
    await assertAgentJobLimits(transaction, options.subject);
    const updated = await transaction.agentJob.updateMany({
      where: options.where,
      data: options.data,
    });
    return updated.count;
  });
}
