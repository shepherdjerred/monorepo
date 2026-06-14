import { describe, it, expect, beforeEach } from "bun:test";
import { setupTestDatabase, testPrisma, cleanupAllTables } from "./helpers.ts";
import {
  startCronJobs,
  stopCronJobs,
  recoverMissedJobs,
} from "@shepherdjerred/sentinel/adapters/cron.ts";
import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";

function makeCronAgent(name: string, schedule: string): AgentDefinition {
  return {
    name,
    description: "Test cron agent",
    systemPrompt: "Test",
    tools: ["Read"],
    maxTurns: 5,
    permissionTier: "read-only",
    triggers: [{ type: "cron", schedule, prompt: "Run scheduled check" }],
    memory: { private: "test", shared: [] },
  };
}

function makeWebhookAgent(name: string): AgentDefinition {
  return {
    name,
    description: "Test webhook agent",
    systemPrompt: "Test",
    tools: ["Read"],
    maxTurns: 5,
    permissionTier: "read-only",
    triggers: [
      {
        type: "webhook",
        source: "github",
        event: "push",
        promptTemplate: "Handle push",
      },
    ],
    memory: { private: "test", shared: [] },
  };
}

await setupTestDatabase();

beforeEach(async () => {
  await cleanupAllTables();
});

describe("recoverMissedJobs", () => {
  it("enqueues catch-up when no previous cron job exists", async () => {
    const registry = new Map<string, AgentDefinition>();
    registry.set("cron-agent", makeCronAgent("cron-agent", "*/5 * * * *"));

    await recoverMissedJobs(registry);

    const jobs = await testPrisma.job.findMany({
      where: { agent: "cron-agent", triggerType: "cron" },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.triggerSource).toBe("cron-agent:recovery");
  });

  it("skips when recent cron job exists within threshold", async () => {
    const registry = new Map<string, AgentDefinition>();
    registry.set("cron-agent", makeCronAgent("cron-agent", "*/5 * * * *"));

    // Insert a recent job (1 minute ago)
    await testPrisma.job.create({
      data: {
        agent: "cron-agent",
        prompt: "Run scheduled check",
        triggerType: "cron",
        triggerSource: "cron-agent",
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    await recoverMissedJobs(registry);

    const jobs = await testPrisma.job.findMany({
      where: { agent: "cron-agent", triggerType: "cron" },
    });
    expect(jobs).toHaveLength(1);
  });

  it("enqueues when last job is stale (>2x interval)", async () => {
    const registry = new Map<string, AgentDefinition>();
    registry.set("cron-agent", makeCronAgent("cron-agent", "*/5 * * * *"));

    // Insert a stale job (20 minutes ago, threshold is 2 * 5min = 10min)
    await testPrisma.job.create({
      data: {
        agent: "cron-agent",
        prompt: "Run scheduled check",
        triggerType: "cron",
        triggerSource: "cron-agent",
        createdAt: new Date(Date.now() - 20 * 60_000),
      },
    });

    await recoverMissedJobs(registry);

    const jobs = await testPrisma.job.findMany({
      where: { agent: "cron-agent", triggerType: "cron" },
    });
    expect(jobs).toHaveLength(2);
  });

  it("does nothing for agents without cron triggers", async () => {
    const registry = new Map<string, AgentDefinition>();
    registry.set("webhook-agent", makeWebhookAgent("webhook-agent"));

    await recoverMissedJobs(registry);

    const jobs = await testPrisma.job.findMany();
    expect(jobs).toHaveLength(0);
  });
});

describe("startCronJobs / stopCronJobs", () => {
  it("registers and stops cron jobs without errors", () => {
    const registry = new Map<string, AgentDefinition>();
    registry.set("cron-agent", makeCronAgent("cron-agent", "*/5 * * * *"));

    startCronJobs(registry);
    stopCronJobs();
  });
});
