/**
 * E2E verification script for Sentinel.
 *
 * Runs against the real Hono app (via app.fetch) with an in-memory SQLite database.
 * Tests webhook endpoints, health checks, tRPC queries, and cron triggers.
 *
 * Usage: bun run scripts/verify-e2e.ts
 */

import { mock } from "bun:test";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// --- Environment setup (BEFORE any app imports) ---
Bun.env["DATABASE_URL"] = "file::memory:?cache=shared";
Bun.env["ANTHROPIC_API_KEY"] = "test-key";
Bun.env["DISCORD_TOKEN"] = "test-token";
Bun.env["DISCORD_CHANNEL_ID"] = "test-channel";
Bun.env["DISCORD_GUILD_ID"] = "test-guild";

const testPrisma = new PrismaClient({
  datasourceUrl: "file::memory:?cache=shared",
});

// Mock database module so all app code uses our in-memory prisma
void mock.module("@shepherdjerred/sentinel/database/index.ts", () => ({
  getPrisma: () => testPrisma,
  initDatabase: () => {},
  disconnectPrisma: () => Promise.resolve(),
}));

// Mock SSE (no real listeners needed)
void mock.module("@shepherdjerred/sentinel/sse/index.ts", () => ({
  emitSSE: () => {},
  addSSEListener: () => () => {},
}));

// --- Now import app modules ---
import { createApp } from "@shepherdjerred/sentinel/adapters/webhook.ts";
import {
  enqueueJob,
  getQueueStats,
} from "@shepherdjerred/sentinel/queue/index.ts";
import {
  startCronJobs,
  stopCronJobs,
} from "@shepherdjerred/sentinel/adapters/cron.ts";
import { agentRegistry } from "@shepherdjerred/sentinel/agents/registry.ts";
import { appRouter } from "@shepherdjerred/sentinel/trpc/router/index.ts";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";

// --- Test config ---
const testConfig: Config = {
  anthropic: { apiKey: "test-key", model: "claude-sonnet-4-20250514" },
  discord: {
    token: "test-token",
    channelId: "test-channel",
    guildId: "test-guild",
    approverRoleIds: [],
  },
  sentry: { dsn: undefined, enabled: false, environment: "development" },
  telemetry: { enabled: false },
  queue: {
    pollIntervalMs: 5000,
    maxJobDurationMs: 600_000,
    defaultMaxRetries: 3,
    maxConcurrentJobs: 3,
  },
  webhooks: {
    port: 3000,
    host: "0.0.0.0",
    githubSecret: "test-github-secret",
    pagerdutySecret: "test-pagerduty-secret",
    bugsinkSecret: "test-bugsink-secret",
    buildkiteToken: "test-buildkite-token",
  },
  permissions: { approvalTimeoutMs: 1_800_000 },
};

// --- Database helpers ---
async function setupDatabase(): Promise<void> {
  await testPrisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Job (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      prompt TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'pending',
      triggerType TEXT NOT NULL,
      triggerSource TEXT NOT NULL,
      triggerMetadata TEXT NOT NULL DEFAULT '{}',
      deduplicationKey TEXT UNIQUE,
      deadlineAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      claimedAt DATETIME,
      completedAt DATETIME,
      result TEXT,
      retryCount INTEGER NOT NULL DEFAULT 0,
      maxRetries INTEGER NOT NULL DEFAULT 3
    )
  `);
  await testPrisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_job_status_priority ON Job(status, priority, createdAt)",
  );
  await testPrisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_job_agent ON Job(agent)",
  );
  await testPrisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ApprovalRequest (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      agent TEXT NOT NULL,
      toolName TEXT NOT NULL,
      toolInput TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decidedBy TEXT,
      reason TEXT,
      expiresAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decidedAt DATETIME
    )
  `);
  await testPrisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_approval_status ON ApprovalRequest(status)",
  );
  await testPrisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_approval_job ON ApprovalRequest(jobId)",
  );
  await testPrisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS AgentSession (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      jobId TEXT NOT NULL,
      startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      endedAt DATETIME,
      turnsUsed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      inputTokens INTEGER NOT NULL DEFAULT 0,
      outputTokens INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function cleanupTables(): Promise<void> {
  await testPrisma.$executeRawUnsafe("DELETE FROM Job");
  await testPrisma.$executeRawUnsafe("DELETE FROM ApprovalRequest");
  await testPrisma.$executeRawUnsafe("DELETE FROM AgentSession");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// --- Test runner ---
let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(
      `    ${error instanceof Error ? error.message : String(error)}`,
    );
    failed++;
  }
}

// --- Main ---
async function main(): Promise<void> {
  console.log("Setting up test database...");
  await setupDatabase();

  const app = createApp(testConfig);

  // ===== Health endpoints =====
  console.log("\nHealth endpoints:");

  await runTest("GET /livez returns 200 ok", async () => {
    const res = await app.fetch(new Request("http://localhost/livez"));
    assertEqual(res.status, 200, "status");
    const body = await res.text();
    assertEqual(body, "ok", "body");
  });

  await runTest("GET /healthz returns 200 ok", async () => {
    const res = await app.fetch(new Request("http://localhost/healthz"));
    assertEqual(res.status, 200, "status");
    const body = await res.text();
    assertEqual(body, "ok", "body");
  });

  await runTest("GET /metrics returns queue stats JSON", async () => {
    const res = await app.fetch(new Request("http://localhost/metrics"));
    assertEqual(res.status, 200, "status");
    const body = (await res.json()) as Record<string, unknown>;
    assert("pending" in body, "missing 'pending' field");
    assert("running" in body, "missing 'running' field");
    assert("completed" in body, "missing 'completed' field");
    assert("failed" in body, "missing 'failed' field");
    assert("cancelled" in body, "missing 'cancelled' field");
    assert("awaitingApproval" in body, "missing 'awaitingApproval' field");
  });

  // ===== GitHub webhook =====
  console.log("\nGitHub webhook:");

  await runTest(
    "POST /webhook/github with valid HMAC enqueues job",
    async () => {
      await cleanupTables();
      const body = JSON.stringify({
        action: "completed",
        workflow_run: {
          conclusion: "failure",
          name: "CI",
          head_branch: "main",
          html_url: "https://github.com/test/repo/actions/runs/1",
          repository: { full_name: "test/repo" },
        },
      });
      const signature = `sha256=${createHmac("sha256", testConfig.webhooks.githubSecret!).update(body).digest("hex")}`;
      const res = await app.fetch(
        new Request("http://localhost/webhook/github", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hub-Signature-256": signature,
            "X-GitHub-Event": "workflow_run",
            "X-GitHub-Delivery": crypto.randomUUID(),
          },
          body,
        }),
      );
      assertEqual(res.status, 200, "status");
      const json = (await res.json()) as Record<string, unknown>;
      assertEqual(json["status"], "enqueued", "response status");
      assert(
        typeof json["jobId"] === "string" && json["jobId"].length > 0,
        "jobId should be a non-empty string",
      );
    },
  );

  await runTest(
    "POST /webhook/github with invalid signature returns 401",
    async () => {
      const body = JSON.stringify({
        action: "completed",
        workflow_run: { conclusion: "failure" },
      });
      const res = await app.fetch(
        new Request("http://localhost/webhook/github", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hub-Signature-256": "sha256=invalid",
            "X-GitHub-Event": "workflow_run",
            "X-GitHub-Delivery": crypto.randomUUID(),
          },
          body,
        }),
      );
      assertEqual(res.status, 401, "status");
    },
  );

  // ===== PagerDuty webhook =====
  console.log("\nPagerDuty webhook:");

  await runTest(
    "POST /webhook/pagerduty with valid signature enqueues job",
    async () => {
      await cleanupTables();
      const body = JSON.stringify({
        event: {
          id: "evt-1",
          event_type: "incident.triggered",
          data: {
            title: "Test Alert",
            urgency: "high",
            html_url: "https://pagerduty.com/incidents/1",
            service: { summary: "test-service" },
          },
        },
      });
      const signature = `v1=${createHmac("sha256", testConfig.webhooks.pagerdutySecret!).update(body).digest("hex")}`;
      const res = await app.fetch(
        new Request("http://localhost/webhook/pagerduty", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PagerDuty-Signature": signature,
          },
          body,
        }),
      );
      assertEqual(res.status, 200, "status");
      const json = (await res.json()) as Record<string, unknown>;
      assertEqual(json["status"], "enqueued", "response status");
      assert(
        typeof json["jobId"] === "string" && json["jobId"].length > 0,
        "jobId should be a non-empty string",
      );
    },
  );

  // ===== Buildkite webhook =====
  console.log("\nBuildkite webhook:");

  await runTest(
    "POST /webhook/buildkite with valid token enqueues job",
    async () => {
      await cleanupTables();
      const body = JSON.stringify({
        build: {
          id: "build-1",
          state: "failed",
          branch: "main",
          web_url: "https://buildkite.com/org/pipe/builds/1",
          message: "Test commit",
        },
        pipeline: { name: "test-pipeline" },
      });
      const res = await app.fetch(
        new Request("http://localhost/webhook/buildkite", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Buildkite-Token": testConfig.webhooks.buildkiteToken!,
            "X-Buildkite-Event": "build.finished",
          },
          body,
        }),
      );
      assertEqual(res.status, 200, "status");
      const json = (await res.json()) as Record<string, unknown>;
      assertEqual(json["status"], "enqueued", "response status");
      assert(
        typeof json["jobId"] === "string" && json["jobId"].length > 0,
        "jobId should be a non-empty string",
      );
    },
  );

  // ===== Bugsink webhook =====
  console.log("\nBugsink webhook:");

  await runTest(
    "POST /webhook/bugsink/:token with correct token enqueues job",
    async () => {
      await cleanupTables();
      const body = JSON.stringify({
        title: "Test Error",
        project: "test-project",
        url: "https://bugsink.example.com/issues/1",
      });
      const res = await app.fetch(
        new Request(
          `http://localhost/webhook/bugsink/${testConfig.webhooks.bugsinkSecret}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          },
        ),
      );
      assertEqual(res.status, 200, "status");
      const json = (await res.json()) as Record<string, unknown>;
      assertEqual(json["status"], "enqueued", "response status");
      assert(
        typeof json["jobId"] === "string" && json["jobId"].length > 0,
        "jobId should be a non-empty string",
      );
    },
  );

  // ===== tRPC =====
  console.log("\ntRPC:");

  await runTest("tRPC stats.queue returns queue stats", async () => {
    await cleanupTables();
    const caller = appRouter.createCaller({ prisma: testPrisma });
    const stats = await caller.stats.queue();
    assert(typeof stats.pending === "number", "pending should be a number");
    assert(typeof stats.running === "number", "running should be a number");
    assert(typeof stats.completed === "number", "completed should be a number");
    assert(typeof stats.failed === "number", "failed should be a number");
  });

  await runTest("tRPC job.create enqueues a job", async () => {
    await cleanupTables();
    const caller = appRouter.createCaller({ prisma: testPrisma });
    const job = await caller.job.create({
      agent: "ci-fixer",
      prompt: "Test job from tRPC",
      priority: "normal",
    });
    assert(
      typeof job.id === "string" && job.id.length > 0,
      "job id should be a non-empty string",
    );
    assertEqual(job.agent, "ci-fixer", "agent");
    assertEqual(job.status, "pending", "status");

    // Verify it shows in the DB
    const found = await testPrisma.job.findUnique({ where: { id: job.id } });
    assert(found !== null, "job should exist in database");
  });

  // ===== Queue =====
  console.log("\nQueue:");

  await runTest(
    "enqueueJob creates a job and getQueueStats reflects it",
    async () => {
      await cleanupTables();
      const job = await enqueueJob({
        agent: "health-checker",
        prompt: "Test direct enqueue",
        triggerType: "manual",
        triggerSource: "e2e-test",
      });
      assert(
        typeof job.id === "string" && job.id.length > 0,
        "job id should be a non-empty string",
      );

      const stats = await getQueueStats();
      assertEqual(stats.pending, 1, "pending count");
    },
  );

  // ===== Cron triggers =====
  console.log("\nCron triggers:");

  await runTest(
    "startCronJobs registers cron jobs for agents with cron triggers",
    async () => {
      // Count how many cron triggers exist in the registry
      let expectedCronCount = 0;
      for (const [, agent] of agentRegistry) {
        for (const trigger of agent.triggers) {
          if (trigger.type === "cron") {
            expectedCronCount++;
          }
        }
      }
      assert(
        expectedCronCount >= 2,
        `expected at least 2 cron triggers, got ${expectedCronCount}`,
      );

      // Start cron jobs -- should not throw
      startCronJobs(agentRegistry);
    },
  );

  await runTest("stopCronJobs cleans up without error", async () => {
    // Should not throw
    stopCronJobs();

    // Starting again and stopping should also work (idempotent)
    startCronJobs(agentRegistry);
    stopCronJobs();
  });

  // ===== Summary =====
  console.log(`\n${passed} passed, ${failed} failed`);
  await testPrisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
