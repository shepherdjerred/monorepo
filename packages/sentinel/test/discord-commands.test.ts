import "./helpers.ts";
import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  cleanupAllTables,
  testConfig,
} from "./helpers.ts";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import type { CommandInteraction } from "@shepherdjerred/sentinel/discord/commands.ts";
import type { DirectMessage } from "@shepherdjerred/sentinel/discord/chat.ts";

function noop() {
  // no-op for mocks
}

// Mock SSE (prevent real event emission)
void mock.module("@shepherdjerred/sentinel/sse/index.ts", () => ({
  emitSSE: noop,
  addSSEListener: () => noop,
}));

// Mock Discord client (chat.ts has circular dependency with client.ts)
void mock.module("@shepherdjerred/sentinel/discord/client.ts", () => ({
  getDiscordClient: () => null,
  startDiscord: noop,
  stopDiscord: noop,
}));

// Mock database to ensure getPrisma returns testPrisma everywhere.
// In CI, bun's module resolution order can cause queue/index.ts to bind the
// real getPrisma before mock.module takes effect. This mock ensures all
// dynamically-imported modules get testPrisma.
void mock.module("@shepherdjerred/sentinel/database/index.ts", () => ({
  getPrisma: () => testPrisma,
  initDatabase: async () => {
    /* no-op */
  },
  disconnectPrisma: async () => {
    /* no-op */
  },
}));

// Import modules under test AFTER mocks
const { handleInteraction } =
  await import("@shepherdjerred/sentinel/discord/commands.ts");
const { handleDirectMessage, updateUserSession } =
  await import("@shepherdjerred/sentinel/discord/chat.ts");

await setupTestDatabase();

beforeEach(async () => {
  await cleanupAllTables();
});

function makeMockInteraction(
  subcommand: string,
  options: Record<string, string> = {},
): {
  interaction: CommandInteraction;
  replies: string[];
  editReplies: string[];
} {
  const replies: string[] = [];
  const editReplies: string[] = [];

  const interaction: CommandInteraction = {
    commandName: "sentinel",
    user: { id: "user-123", tag: "TestUser#1234" },
    member: {
      roles: { cache: new Map([["role-1", { id: "role-1" }]]) },
    },
    guildId: "guild-123",
    channelId: "channel-123",
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string, _required?: boolean) => options[name] ?? null,
    },
    deferReply: async () => {
      // no-op mock
    },
    editReply: async (content: string) => {
      editReplies.push(content);
    },
    reply: async (
      content: string | { content: string; ephemeral?: boolean },
    ) => {
      replies.push(typeof content === "string" ? content : content.content);
    },
  };

  return { interaction, replies, editReplies };
}

function makeMockMessage(
  content: string,
  authorId = "user-456",
  messageId: string = crypto.randomUUID(),
): { message: DirectMessage; reactions: string[] } {
  const reactions: string[] = [];

  const message: DirectMessage = {
    id: messageId,
    content,
    author: { id: authorId },
    channelId: "dm-channel-1",
    channel: {
      sendTyping: async () => {
        // no-op mock
      },
    },
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async () => {
      // no-op mock
    },
  };

  return { message, reactions };
}

describe("slash commands", () => {
  test("/sentinel status lists jobs", async () => {
    // Create jobs with different statuses
    await testPrisma.job.create({
      data: {
        agent: "ci-fixer",
        prompt: "Fix CI",
        status: "running",
        triggerType: "cron",
        triggerSource: "scheduler",
        claimedAt: new Date(),
      },
    });
    await testPrisma.job.create({
      data: {
        agent: "health-checker",
        prompt: "Check health",
        status: "pending",
        triggerType: "webhook",
        triggerSource: "pagerduty",
      },
    });
    await testPrisma.job.create({
      data: {
        agent: "ci-fixer",
        prompt: "Fix tests",
        status: "completed",
        triggerType: "cron",
        triggerSource: "scheduler",
        completedAt: new Date(),
      },
    });

    const { interaction, editReplies } = makeMockInteraction("status");
    await handleInteraction(interaction, testConfig);

    expect(editReplies).toHaveLength(1);
    expect(editReplies[0]).toContain("Running");
    expect(editReplies[0]).toContain("Pending");
    expect(editReplies[0]).toContain("Recent");
    expect(editReplies[0]).toContain("ci-fixer");
    expect(editReplies[0]).toContain("health-checker");
  });

  test("/sentinel status shows no jobs message when empty", async () => {
    const { interaction, editReplies } = makeMockInteraction("status");
    await handleInteraction(interaction, testConfig);

    expect(editReplies).toHaveLength(1);
    expect(editReplies[0]).toContain("No jobs found");
  });

  test("/sentinel ask enqueues personal-assistant job", async () => {
    const { interaction, editReplies } = makeMockInteraction("ask", {
      prompt: "What is the CI status?",
    });
    await handleInteraction(interaction, testConfig);

    expect(editReplies).toHaveLength(1);
    expect(editReplies[0]).toContain("Job enqueued");

    const jobs = await testPrisma.job.findMany({
      where: { agent: "personal-assistant" },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.triggerSource).toBe("slash_command");
    expect(jobs[0]!.triggerType).toBe("discord");
    expect(jobs[0]!.prompt).toBe("What is the CI status?");

    const metadata = JSON.parse(jobs[0]!.triggerMetadata);
    expect(metadata.userId).toBe("user-123");
  });
});

describe("slash commands - approvals", () => {
  test("/sentinel approve updates approval request", async () => {
    const job = await testPrisma.job.create({
      data: {
        agent: "ci-fixer",
        prompt: "Fix something",
        status: "running",
        triggerType: "cron",
        triggerSource: "scheduler",
      },
    });

    const approval = await testPrisma.approvalRequest.create({
      data: {
        jobId: job.id,
        agent: "ci-fixer",
        toolName: "Bash",
        toolInput: JSON.stringify({ command: "rm -rf /tmp/test" }),
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { interaction, replies } = makeMockInteraction("approve", {
      id: approval.id,
    });
    await handleInteraction(interaction, testConfig);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("approved");

    const updated = await testPrisma.approvalRequest.findUnique({
      where: { id: approval.id },
    });
    expect(updated!.status).toBe("approved");
    expect(updated!.decidedBy).toBe("user-123");
  });

  test("/sentinel deny updates approval request", async () => {
    const job = await testPrisma.job.create({
      data: {
        agent: "ci-fixer",
        prompt: "Fix something",
        status: "running",
        triggerType: "cron",
        triggerSource: "scheduler",
      },
    });

    const approval = await testPrisma.approvalRequest.create({
      data: {
        jobId: job.id,
        agent: "ci-fixer",
        toolName: "Bash",
        toolInput: JSON.stringify({ command: "rm -rf /tmp/test" }),
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { interaction, replies } = makeMockInteraction("deny", {
      id: approval.id,
      reason: "Too dangerous",
    });
    await handleInteraction(interaction, testConfig);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("denied");

    const updated = await testPrisma.approvalRequest.findUnique({
      where: { id: approval.id },
    });
    expect(updated!.status).toBe("denied");
    expect(updated!.decidedBy).toBe("user-123");
  });

  test("/sentinel approve rejects DMs (no member)", async () => {
    const { interaction, replies } = makeMockInteraction("approve", {
      id: "some-id",
    });
    interaction.member = null;

    await handleInteraction(interaction, testConfig);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("server, not via DMs");
  });

  test("/sentinel approve rejects unauthorized users", async () => {
    const configWithRoles: Config = {
      ...testConfig,
      discord: {
        ...testConfig.discord!,
        approverRoleIds: ["admin-role"],
      },
    };

    const { interaction, replies } = makeMockInteraction("approve", {
      id: "some-id",
    });
    await handleInteraction(interaction, configWithRoles);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("do not have permission");
  });

  test("/sentinel approve handles already-decided request", async () => {
    const job = await testPrisma.job.create({
      data: {
        agent: "ci-fixer",
        prompt: "Fix something",
        status: "running",
        triggerType: "cron",
        triggerSource: "scheduler",
      },
    });

    await testPrisma.approvalRequest.create({
      data: {
        id: "already-decided-id",
        jobId: job.id,
        agent: "ci-fixer",
        toolName: "Bash",
        toolInput: JSON.stringify({ command: "echo hi" }),
        status: "approved",
        decidedBy: "other-user",
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { interaction, replies } = makeMockInteraction("approve", {
      id: "already-decided-id",
    });
    await handleInteraction(interaction, testConfig);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("not found or has already been decided");
  });
});

describe("direct messages", () => {
  test("handleDirectMessage enqueues a job", async () => {
    const { message } = makeMockMessage("Hello sentinel");
    await handleDirectMessage(message);

    const jobs = await testPrisma.job.findMany({
      where: { agent: "personal-assistant" },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.triggerSource).toBe("dm");
    expect(jobs[0]!.triggerType).toBe("discord");
    expect(jobs[0]!.prompt).toBe("Hello sentinel");
  });

  test("handleDirectMessage adds hourglass reaction", async () => {
    const { message, reactions } = makeMockMessage("React test");
    await handleDirectMessage(message);

    expect(reactions).toContain("\u23F3");
  });

  test("handleDirectMessage ignores empty messages", async () => {
    const { message } = makeMockMessage("   ");
    await handleDirectMessage(message);

    const jobs = await testPrisma.job.findMany({
      where: { agent: "personal-assistant" },
    });
    expect(jobs).toHaveLength(0);
  });

  test("handleDirectMessage deduplicates messages", async () => {
    const fixedId = "dedup-message-id";
    const { message: msg1 } = makeMockMessage("Hello", "user-456", fixedId);
    const { message: msg2 } = makeMockMessage("Hello", "user-456", fixedId);

    await handleDirectMessage(msg1);
    await handleDirectMessage(msg2);

    const jobs = await testPrisma.job.findMany({
      where: { agent: "personal-assistant" },
    });
    expect(jobs).toHaveLength(1);
  });

  test("handleDirectMessage includes resumeSessionId", async () => {
    updateUserSession("user-789", "sdk-session-1");

    const { message } = makeMockMessage("Continue conversation", "user-789");
    await handleDirectMessage(message);

    const jobs = await testPrisma.job.findMany({
      where: { agent: "personal-assistant" },
    });
    expect(jobs).toHaveLength(1);

    const metadata = JSON.parse(jobs[0]!.triggerMetadata);
    expect(metadata.resumeSessionId).toBe("sdk-session-1");
  });
});
