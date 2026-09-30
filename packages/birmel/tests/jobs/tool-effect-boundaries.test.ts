import { describe, expect, test } from "vitest";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  runAgentJobById,
  setAgentJobRuntimeDependencies,
} from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";
import { registerAgentJobTestEnvironment } from "./agent-job-test-environment.ts";

const ACTOR_USER_ID = "186665676134547461";
const GUILD_ID = "987654321098765432";
const CHANNEL_ID = "876543210987654321";
const SOURCE_MESSAGE_ID = "765432109876543210";

async function createDueToolJob(
  toolId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const job = await prisma.agentJob.create({
    data: {
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      actorUserId: ACTOR_USER_ID,
      sourceChannelId: CHANNEL_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() - 1000).toISOString(),
      nextRunAt: new Date(Date.now() - 1000),
      payloadKind: "tool",
      toolId,
      toolInput: JSON.stringify(input),
      maxAttempts: 1,
    },
  });
  return job.id;
}

async function loadJobAndRun(jobId: string) {
  return await Promise.all([
    prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } }),
    prisma.agentJobRun.findFirstOrThrow({ where: { jobId } }),
  ]);
}

registerAgentJobTestEnvironment(ACTOR_USER_ID);

describe("durable tool effect boundaries", () => {
  test("rejects an unsafe browser destination before acquiring an effect checkpoint", async () => {
    let executions = 0;
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executions += 1;
        return { success: true };
      },
    });
    const jobId = await createDueToolJob("browser-automation", {
      action: "open",
      url: "http://example.com",
    });

    await runAgentJobById(jobId);

    const [job, run] = await loadJobAndRun(jobId);
    expect(executions).toBe(0);
    expect(job.status).toBe("failed");
    expect(job.lastStatus).toBe("error");
    expect(job.lastError).toBe("Tool reported failure");
    expect(run.status).toBe("failed");
  });

  test("rejects missing message fields before acquiring an effect checkpoint", async () => {
    let executions = 0;
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executions += 1;
        return { success: true };
      },
    });
    const jobId = await createDueToolJob("manage-message", {
      action: "send",
      channelId: "400000000000000002",
    });

    await runAgentJobById(jobId);

    const [job, run] = await loadJobAndRun(jobId);
    expect(executions).toBe(0);
    expect(job.status).toBe("failed");
    expect(job.lastStatus).toBe("error");
    expect(run.status).toBe("failed");
  });

  test("treats rejected external fetches as read failures without an effect checkpoint", async () => {
    const jobId = await createDueToolJob("external-service", {
      action: "fetch-url",
      url: "http://example.com",
    });

    await runAgentJobById(jobId);

    const [job, run] = await loadJobAndRun(jobId);
    expect(job.status).toBe("failed");
    expect(job.lastStatus).toBe("error");
    expect(run.status).toBe("failed");
  });

  test("treats credential-free sandbox failures as ordinary tool failures", async () => {
    let executions = 0;
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executions += 1;
        return { success: false };
      },
    });
    const jobId = await createDueToolJob("run-code", {
      language: "python",
      source: "raise RuntimeError()",
    });

    await runAgentJobById(jobId);

    const [job, run] = await loadJobAndRun(jobId);
    expect(executions).toBe(1);
    expect(job.status).toBe("failed");
    expect(job.lastStatus).toBe("error");
    expect(run.status).toBe("failed");
  });
});
