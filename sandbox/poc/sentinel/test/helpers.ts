import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createApp } from "@shepherdjerred/sentinel/adapters/webhook.ts";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";
import { setGlobalPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import { createHmac } from "node:crypto";

// Set env vars once for all test files
Bun.env["DATABASE_URL"] = "file::memory:?cache=shared";
Bun.env["ANTHROPIC_API_KEY"] = "test-key";
Bun.env["DISCORD_TOKEN"] = "test-token";
Bun.env["DISCORD_CHANNEL_ID"] = "test-channel";
Bun.env["DISCORD_GUILD_ID"] = "test-guild";

export const testPrisma = new PrismaClient({
  datasourceUrl: "file::memory:?cache=shared",
});

// Inject testPrisma into the global singleton so getPrisma() returns it
setGlobalPrisma(testPrisma);

export async function setupTestDatabase(): Promise<void> {
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
  await testPrisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_job_agent ON Job(agent)
  `);
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
  await testPrisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_approval_status ON ApprovalRequest(status)
  `);
  await testPrisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_approval_job ON ApprovalRequest(jobId)
  `);
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

export async function cleanupAllTables(): Promise<void> {
  await testPrisma.$executeRawUnsafe("DELETE FROM Job");
  await testPrisma.$executeRawUnsafe("DELETE FROM ApprovalRequest");
  await testPrisma.$executeRawUnsafe("DELETE FROM AgentSession");
}

export const testConfig: Config = {
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

export function createTestApp(configOverrides?: Partial<Config>) {
  const config = { ...testConfig, ...configOverrides };
  return createApp(config);
}

export const WebhookResponseSchema = z.object({
  status: z.string().optional(),
  reason: z.string().optional(),
  jobId: z.string().optional(),
  error: z.string().optional(),
});

export async function parseResponse(res: Response) {
  return WebhookResponseSchema.parse(await res.json());
}

export const testAgent: AgentDefinition = {
  name: "test-agent",
  description: "Test agent",
  systemPrompt: "You are a test agent.",
  tools: [
    "Read",
    "Glob",
    "Grep",
    "Bash",
    "Edit",
    "Write",
    "Task",
    "WebSearch",
    "WebFetch",
  ],
  maxTurns: 10,
  permissionTier: "write-with-approval",
  triggers: [],
  memory: { private: "test", shared: [] },
};

export function generateHmacSignature(
  secret: string,
  body: string,
  prefix: string,
): string {
  return `${prefix}${createHmac("sha256", secret).update(body).digest("hex")}`;
}
