import { describe, it, expect, beforeEach } from "bun:test";
import { setupTestDatabase, testPrisma } from "./helpers.ts";
import {
  enqueueJob,
  claimJob,
  completeJob,
  failJob,
  recoverStaleJobs,
  getQueueStats,
} from "@shepherdjerred/sentinel/queue/index.ts";

beforeEach(async () => {
  await testPrisma.$executeRawUnsafe("DELETE FROM Job");
});

// Run setup once
await setupTestDatabase();

describe("enqueueJob", () => {
  it("should create a job with default priority", async () => {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI status",
      triggerType: "cron",
      triggerSource: "scheduler",
    });

    expect(job.id).toBeDefined();
    expect(job.agent).toBe("ci-fixer");
    expect(job.prompt).toBe("Check CI status");
    expect(job.priority).toBe(2); // normal
    expect(job.status).toBe("pending");
    expect(job.retryCount).toBe(0);
  });

  it("should create a job with custom priority", async () => {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Urgent fix",
      triggerType: "webhook",
      triggerSource: "github",
      priority: "critical",
    });

    expect(job.priority).toBe(0);
  });

  it("should deduplicate by key", async () => {
    const job1 = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI",
      triggerType: "cron",
      triggerSource: "scheduler",
      deduplicationKey: "ci-check-main",
    });

    const job2 = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI again",
      triggerType: "cron",
      triggerSource: "scheduler",
      deduplicationKey: "ci-check-main",
    });

    expect(job1.id).toBe(job2.id);
    expect(job2.prompt).toBe("Check CI"); // original prompt preserved
  });
});

describe("claimJob", () => {
  it("should claim the highest-priority pending job", async () => {
    await enqueueJob({
      agent: "ci-fixer",
      prompt: "Low priority",
      triggerType: "cron",
      triggerSource: "scheduler",
      priority: "low",
    });
    await enqueueJob({
      agent: "ci-fixer",
      prompt: "Critical fix",
      triggerType: "webhook",
      triggerSource: "github",
      priority: "critical",
    });
    await enqueueJob({
      agent: "ci-fixer",
      prompt: "Normal task",
      triggerType: "cron",
      triggerSource: "scheduler",
    });

    const claimed = await claimJob();
    expect(claimed).not.toBeNull();
    expect(claimed!.prompt).toBe("Critical fix");
    expect(claimed!.status).toBe("running");
    expect(claimed!.claimedAt).toBeDefined();
  });

  it("should return null when no pending jobs", async () => {
    const claimed = await claimJob();
    expect(claimed).toBeNull();
  });

  it("should skip expired jobs", async () => {
    await enqueueJob({
      agent: "ci-fixer",
      prompt: "Expired job",
      triggerType: "cron",
      triggerSource: "scheduler",
      deadlineAt: new Date(Date.now() - 60_000), // 1 min ago
    });

    const claimed = await claimJob();
    expect(claimed).toBeNull();
  });
});

describe("completeJob", () => {
  it("should mark a job as completed", async () => {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI",
      triggerType: "cron",
      triggerSource: "scheduler",
    });
    const claimed = await claimJob();
    expect(claimed).not.toBeNull();

    const completed = await completeJob(job.id, "All green");
    expect(completed.status).toBe("completed");
    expect(completed.result).toBe("All green");
    expect(completed.completedAt).toBeDefined();
  });
});

describe("failJob", () => {
  it("should requeue job when retries remain", async () => {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI",
      triggerType: "cron",
      triggerSource: "scheduler",
      maxRetries: 3,
    });
    await claimJob();

    const failed = await failJob(job.id, "Network timeout");
    expect(failed.status).toBe("pending");
    expect(failed.retryCount).toBe(1);
    expect(failed.claimedAt).toBeNull();
  });

  it("should permanently fail when retries exhausted", async () => {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI",
      triggerType: "cron",
      triggerSource: "scheduler",
      maxRetries: 0,
    });
    await claimJob();

    const failed = await failJob(job.id, "Network timeout");
    expect(failed.status).toBe("failed");
    expect(failed.result).toBe("Network timeout");
    expect(failed.completedAt).toBeDefined();
  });
});

describe("recoverStaleJobs", () => {
  it("should recover stuck running jobs", async () => {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI",
      triggerType: "cron",
      triggerSource: "scheduler",
    });
    await claimJob();

    // Manually set claimedAt to be older than the threshold
    await testPrisma.job.update({
      where: { id: job.id },
      data: { claimedAt: new Date(Date.now() - 700_000) },
    });

    const recovered = await recoverStaleJobs();
    expect(recovered).toBe(1);

    const updatedJob = await testPrisma.job.findUnique({
      where: { id: job.id },
    });
    expect(updatedJob!.status).toBe("pending");
    expect(updatedJob!.retryCount).toBe(1);
  });
});

describe("getQueueStats", () => {
  it("should return counts by status", async () => {
    await enqueueJob({
      agent: "ci-fixer",
      prompt: "Job 1",
      triggerType: "cron",
      triggerSource: "scheduler",
    });
    await enqueueJob({
      agent: "ci-fixer",
      prompt: "Job 2",
      triggerType: "cron",
      triggerSource: "scheduler",
    });
    await claimJob(); // one becomes running

    const stats = await getQueueStats();
    expect(stats.pending).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(0);
  });
});
