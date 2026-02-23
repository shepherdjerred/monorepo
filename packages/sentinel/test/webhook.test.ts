import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createApp } from "@shepherdjerred/sentinel/adapters/webhook.ts";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";

const WebhookResponseSchema = z.object({
  status: z.string().optional(),
  reason: z.string().optional(),
  jobId: z.string().optional(),
  error: z.string().optional(),
});

async function parseResponse(res: Response) {
  return WebhookResponseSchema.parse(await res.json());
}

// Use in-memory SQLite for tests
Bun.env["DATABASE_URL"] = "file::memory:?cache=shared";
Bun.env["ANTHROPIC_API_KEY"] = "test-key";
Bun.env["DISCORD_TOKEN"] = "test-token";
Bun.env["DISCORD_CHANNEL_ID"] = "test-channel";
Bun.env["DISCORD_GUILD_ID"] = "test-guild";

const testPrisma = new PrismaClient({
  datasourceUrl: "file::memory:?cache=shared",
});

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
  await testPrisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_job_status_priority ON Job(status, priority, createdAt)
  `);
}

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

beforeEach(async () => {
  await setupDatabase();
  await testPrisma.$executeRawUnsafe("DELETE FROM Job");
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("Buildkite webhook", () => {
  it("rejects requests without token", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with wrong token", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "wrong-token",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("ignores non-build.finished events", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.started",
      },
      body: JSON.stringify({ build: { state: "running" } }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("ignored");
  });

  it("ignores non-failed builds", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.finished",
      },
      body: JSON.stringify({
        build: { state: "passed", branch: "main", id: "123" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("ignored");
    expect(body.reason).toBe("not a failure");
  });

  it("ignores failures on non-main branches", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.finished",
      },
      body: JSON.stringify({
        build: { state: "failed", branch: "feature/test", id: "123" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("ignored");
    expect(body.reason).toBe("not main branch");
  });

  it("enqueues failed main branch builds", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/buildkite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Buildkite-Token": "test-buildkite-token",
        "X-Buildkite-Event": "build.finished",
      },
      body: JSON.stringify({
        build: {
          id: "build-456",
          state: "failed",
          branch: "main",
          web_url: "https://buildkite.com/org/pipeline/builds/123",
          message: "fix: broken thing",
        },
        pipeline: {
          name: "monorepo",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("enqueued");
    expect(body.jobId).toBeDefined();

    // Verify job was created in the database
    const job = await testPrisma.job.findFirst({
      where: { deduplicationKey: "buildkite:build-456" },
    });
    expect(job).not.toBeNull();
    expect(job?.agent).toBe("ci-fixer");
    expect(job?.triggerSource).toBe("buildkite");
  });
});

describe("Bugsink webhook (token-in-URL)", () => {
  it("rejects requests with wrong token", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/bugsink/wrong-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Error", project: "test", url: "http://example.com" }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts requests with correct token", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/bugsink/test-bugsink-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "TypeError: null is not an object",
        project: "sentinel",
        url: "https://bugsink.example.com/issues/123",
      }),
    });
    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.status).toBe("enqueued");
    expect(body.jobId).toBeDefined();
  });

  it("returns 404 for old bugsink path without token", async () => {
    const app = createApp(testConfig);
    const res = await app.request("/webhook/bugsink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
