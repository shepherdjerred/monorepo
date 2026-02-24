import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  cleanupAllTables,
} from "./helpers.ts";
import { ConversationLogger } from "@shepherdjerred/sentinel/history/index.ts";
import { appRouter } from "@shepherdjerred/sentinel/trpc/router/index.ts";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { ConversationEntry } from "@shepherdjerred/sentinel/types/history.ts";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.join(import.meta.dirname, "../data");
const CONVERSATIONS_DIR = path.join(DATA_DIR, "conversations");
const TEST_AGENT = "test-integration-agent";

const caller = appRouter.createCaller({ prisma: testPrisma });

function makeEntry(
  overrides: Partial<ConversationEntry> & {
    role: ConversationEntry["role"];
    content: string;
    sessionId: string;
    jobId: string;
    agent: string;
  },
): ConversationEntry {
  return {
    timestamp: new Date().toISOString(),
    turnNumber: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
});

describe("conversation tRPC", () => {
  beforeEach(async () => {
    await cleanupAllTables();
  });

  afterEach(async () => {
    await rm(path.join(CONVERSATIONS_DIR, TEST_AGENT), {
      recursive: true,
      force: true,
    });
  });

  describe("conversation.list", () => {
    test("groups files by agent", async () => {
      const sessionId = randomUUID();
      const jobId = randomUUID();
      const logger = new ConversationLogger(
        TEST_AGENT,
        jobId,
        sessionId,
        DATA_DIR,
      );

      await logger.appendEntry(
        makeEntry({
          role: "system",
          content: "system prompt",
          sessionId,
          jobId,
          agent: TEST_AGENT,
        }),
      );

      const result = await caller.conversation.list();
      const group = result.find((g) => g.agent === TEST_AGENT);

      expect(group).toBeDefined();
      expect(group?.files.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("conversation.read", () => {
    test("returns entries from a written file", async () => {
      const sessionId = randomUUID();
      const jobId = randomUUID();
      const logger = new ConversationLogger(
        TEST_AGENT,
        jobId,
        sessionId,
        DATA_DIR,
      );

      const entries: ConversationEntry[] = [
        makeEntry({
          role: "system",
          content: "system_prompt",
          sessionId,
          jobId,
          agent: TEST_AGENT,
          turnNumber: 0,
        }),
        makeEntry({
          role: "assistant",
          content: "I will investigate.",
          sessionId,
          jobId,
          agent: TEST_AGENT,
          turnNumber: 1,
        }),
        makeEntry({
          role: "tool_use",
          content: "bash ls -la",
          sessionId,
          jobId,
          agent: TEST_AGENT,
          toolName: "Bash",
          toolInput: "ls -la",
          turnNumber: 2,
        }),
        makeEntry({
          role: "tool_result",
          content: "file1.txt file2.txt",
          sessionId,
          jobId,
          agent: TEST_AGENT,
          turnNumber: 3,
        }),
        makeEntry({
          role: "system",
          content: JSON.stringify({ totalTurns: 4, outcome: "completed" }),
          sessionId,
          jobId,
          agent: TEST_AGENT,
          turnNumber: 0,
          metadata: { type: "summary" },
        }),
      ];

      for (const entry of entries) {
        await logger.appendEntry(entry);
      }

      const filename = path.basename(logger.filePath);
      const result = await caller.conversation.read({
        filename,
        agent: TEST_AGENT,
      });

      expect(result).toHaveLength(entries.length);
      expect(result[0]?.role).toBe("system");
      expect(result[0]?.content).toBe("system_prompt");
      expect(result[1]?.role).toBe("assistant");
      expect(result[2]?.role).toBe("tool_use");
      expect(result[3]?.role).toBe("tool_result");
      expect(result[4]?.role).toBe("system");
    });
  });

  describe("conversation.bySession", () => {
    test("finds correct file", async () => {
      const sessionId = randomUUID();
      const jobId = randomUUID();
      const logger = new ConversationLogger(
        TEST_AGENT,
        jobId,
        sessionId,
        DATA_DIR,
      );

      await logger.appendEntry(
        makeEntry({
          role: "system",
          content: "system prompt",
          sessionId,
          jobId,
          agent: TEST_AGENT,
        }),
      );
      await logger.appendEntry(
        makeEntry({
          role: "assistant",
          content: "response",
          sessionId,
          jobId,
          agent: TEST_AGENT,
          turnNumber: 1,
        }),
      );

      const result = await caller.conversation.bySession({ sessionId });

      expect(result).not.toBeNull();
      expect(result?.entries).toHaveLength(2);
      expect(result?.file.sessionId).toBe(sessionId);
    });

    test("returns null for nonexistent session", async () => {
      const result = await caller.conversation.bySession({
        sessionId: randomUUID(),
      });
      expect(result).toBeNull();
    });
  });

  describe("conversation.byJob", () => {
    test("finds correct file", async () => {
      const sessionId = randomUUID();
      const jobId = randomUUID();
      const logger = new ConversationLogger(
        TEST_AGENT,
        jobId,
        sessionId,
        DATA_DIR,
      );

      await logger.appendEntry(
        makeEntry({
          role: "system",
          content: "system prompt for job lookup",
          sessionId,
          jobId,
          agent: TEST_AGENT,
        }),
      );

      const result = await caller.conversation.byJob({ jobId });

      expect(result).not.toBeNull();
      expect(result?.entries).toHaveLength(1);
      expect(result?.entries[0]?.jobId).toBe(jobId);
    });

    test("returns null for nonexistent job", async () => {
      const result = await caller.conversation.byJob({
        jobId: randomUUID(),
      });
      expect(result).toBeNull();
    });
  });
});

describe("session tRPC", () => {
  beforeEach(async () => {
    await cleanupAllTables();
  });

  describe("session.list", () => {
    test("returns created sessions", async () => {
      const sessionId = randomUUID();
      const jobId = randomUUID();

      await testPrisma.agentSession.create({
        data: {
          id: sessionId,
          agent: TEST_AGENT,
          jobId,
          status: "completed",
          turnsUsed: 5,
          inputTokens: 1000,
          outputTokens: 500,
        },
      });

      const result = await caller.session.list({ agent: TEST_AGENT });

      expect(result.sessions.length).toBeGreaterThanOrEqual(1);
      const session = result.sessions.find((s) => s.id === sessionId);
      expect(session).toBeDefined();
      expect(session?.agent).toBe(TEST_AGENT);
      expect(session?.jobId).toBe(jobId);
      expect(session?.turnsUsed).toBe(5);
    });
  });

  describe("session.byId", () => {
    test("returns session by ID", async () => {
      const sessionId = randomUUID();
      const jobId = randomUUID();

      await testPrisma.agentSession.create({
        data: {
          id: sessionId,
          agent: TEST_AGENT,
          jobId,
          status: "running",
          turnsUsed: 3,
          inputTokens: 800,
          outputTokens: 200,
        },
      });

      const result = await caller.session.byId({ id: sessionId });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(sessionId);
      expect(result?.agent).toBe(TEST_AGENT);
      expect(result?.status).toBe("running");
    });
  });
});
