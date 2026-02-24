import { describe, it, expect, afterEach } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import "./helpers.ts";
import { createConversationLogger } from "@shepherdjerred/sentinel/history/index.ts";

const TEST_DATA_DIR = path.join(import.meta.dirname, "../data/test-conversations");

const ConversationEntrySchema = z.object({
  timestamp: z.string(),
  sessionId: z.string(),
  agent: z.string(),
  jobId: z.string(),
  role: z.enum(["user", "assistant", "tool_use", "tool_result", "system"]),
  content: z.string(),
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  toolUseId: z.string().optional(),
  turnNumber: z.number(),
  model: z.string().optional(),
  tokenUsage: z.object({ input: z.number(), output: z.number() }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type ParsedEntry = z.infer<typeof ConversationEntrySchema>;

afterEach(async () => {
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
});

function parseJsonl(content: string): ParsedEntry[] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ConversationEntrySchema.parse(JSON.parse(line)));
}

describe("ConversationLogger", () => {
  it("creates a JSONL file with conversation entries", async () => {
    const logger = createConversationLogger("test-agent", "job-123", "session-abc", TEST_DATA_DIR);

    await logger.appendEntry({
      timestamp: "2026-02-24T00:00:00.000Z",
      sessionId: "session-abc",
      agent: "test-agent",
      jobId: "job-123",
      role: "system",
      content: "You are a test agent.",
      turnNumber: 0,
      metadata: { type: "system_prompt" },
    });

    await logger.appendEntry({
      timestamp: "2026-02-24T00:00:01.000Z",
      sessionId: "session-abc",
      agent: "test-agent",
      jobId: "job-123",
      role: "assistant",
      content: "Hello! How can I help?",
      turnNumber: 1,
      model: "claude-sonnet-4-20250514",
      tokenUsage: { input: 100, output: 50 },
    });

    await logger.appendEntry({
      timestamp: "2026-02-24T00:00:02.000Z",
      sessionId: "session-abc",
      agent: "test-agent",
      jobId: "job-123",
      role: "tool_use",
      content: "",
      toolName: "Bash",
      toolInput: '{"command":"git status"}',
      toolUseId: "tu-1",
      turnNumber: 1,
    });

    await logger.appendEntry({
      timestamp: "2026-02-24T00:00:03.000Z",
      sessionId: "session-abc",
      agent: "test-agent",
      jobId: "job-123",
      role: "tool_result",
      content: "On branch main\nnothing to commit",
      turnNumber: 1,
    });

    const raw = await readFile(logger.getFilePath(), "utf8");
    const entries = parseJsonl(raw);

    expect(entries).toHaveLength(4);
    expect(entries[0]!.role).toBe("system");
    expect(entries[0]!.metadata).toEqual({ type: "system_prompt" });
    expect(entries[1]!.role).toBe("assistant");
    expect(entries[1]!.content).toBe("Hello! How can I help?");
    expect(entries[1]!.model).toBe("claude-sonnet-4-20250514");
    expect(entries[2]!.role).toBe("tool_use");
    expect(entries[2]!.toolName).toBe("Bash");
    expect(entries[3]!.role).toBe("tool_result");
    expect(entries[3]!.content).toContain("nothing to commit");
  });

  it("writes summary with costs and token usage", async () => {
    const logger = createConversationLogger("ci-fixer", "job-456", "session-def", TEST_DATA_DIR);

    await logger.writeSummary({
      totalTurns: 5,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      durationMs: 3000,
      outcome: "completed",
      totalCostUsd: 0.05,
      durationApiMs: 2500,
      modelUsage: {
        "claude-sonnet-4-20250514": {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 100,
          costUsd: 0.05,
        },
      },
      permissionDenials: [],
      systemPrompt: "You are a CI fixer.",
    });

    const raw = await readFile(logger.getFilePath(), "utf8");
    const entries = parseJsonl(raw);

    expect(entries).toHaveLength(1);
    const summary = JSON.parse(entries[0]!.content);
    expect(summary.totalTurns).toBe(5);
    expect(summary.totalCostUsd).toBe(0.05);
    expect(summary.outcome).toBe("completed");
    expect(summary.permissionDenials).toEqual([]);
  });

  it("truncates very long content", async () => {
    const logger = createConversationLogger("test-agent", "job-789", "session-ghi", TEST_DATA_DIR);
    const longContent = "x".repeat(200_000);

    await logger.appendEntry({
      timestamp: "2026-02-24T00:00:00.000Z",
      sessionId: "session-ghi",
      agent: "test-agent",
      jobId: "job-789",
      role: "tool_result",
      content: longContent,
      turnNumber: 1,
    });

    const raw = await readFile(logger.getFilePath(), "utf8");
    const entries = parseJsonl(raw);

    expect(entries[0]!.content.length).toBeLessThan(200_000);
    expect(entries[0]!.content).toContain("[truncated");
  });

  it("creates agent subdirectory automatically", async () => {
    const logger = createConversationLogger("new-agent", "job-xyz", "session-jkl", TEST_DATA_DIR);

    await logger.appendEntry({
      timestamp: "2026-02-24T00:00:00.000Z",
      sessionId: "session-jkl",
      agent: "new-agent",
      jobId: "job-xyz",
      role: "system",
      content: "test",
      turnNumber: 0,
    });

    const filePath = logger.getFilePath();
    expect(filePath).toContain("new-agent");

    const raw = await readFile(filePath, "utf8");
    expect(raw.length).toBeGreaterThan(0);
  });
});

describe("multi-turn Discord conversation flow", () => {
  it("creates separate conversation files per turn", async () => {
    // Turn 1: User asks a question
    const logger1 = createConversationLogger(
      "personal-assistant", "job-dm-1", "session-turn1", TEST_DATA_DIR,
    );

    await logger1.appendEntry({
      timestamp: "2026-02-24T00:00:00.000Z",
      sessionId: "session-turn1",
      agent: "personal-assistant",
      jobId: "job-dm-1",
      role: "system",
      content: "You are a personal assistant.",
      turnNumber: 0,
      metadata: { type: "system_prompt" },
    });

    await logger1.appendEntry({
      timestamp: "2026-02-24T00:00:01.000Z",
      sessionId: "session-turn1",
      agent: "personal-assistant",
      jobId: "job-dm-1",
      role: "assistant",
      content: "The answer to 2+2 is 4.",
      turnNumber: 1,
      model: "claude-sonnet-4-20250514",
      tokenUsage: { input: 200, output: 20 },
    });

    await logger1.writeSummary({
      totalTurns: 1, totalInputTokens: 200, totalOutputTokens: 20,
      durationMs: 1500, outcome: "completed", totalCostUsd: 0.002,
      durationApiMs: 1000, modelUsage: {}, permissionDenials: [],
      systemPrompt: "You are a personal assistant.",
    });

    // Turn 2: User follows up (would use resume in real flow)
    const logger2 = createConversationLogger(
      "personal-assistant", "job-dm-2", "session-turn2", TEST_DATA_DIR,
    );

    await logger2.appendEntry({
      timestamp: "2026-02-24T00:01:00.000Z",
      sessionId: "session-turn2",
      agent: "personal-assistant",
      jobId: "job-dm-2",
      role: "system",
      content: "You are a personal assistant.",
      turnNumber: 0,
      metadata: { type: "system_prompt" },
    });

    await logger2.appendEntry({
      timestamp: "2026-02-24T00:01:01.000Z",
      sessionId: "session-turn2",
      agent: "personal-assistant",
      jobId: "job-dm-2",
      role: "assistant",
      content: "Sure! 2+2=4 and 3+3=6.",
      turnNumber: 1,
      model: "claude-sonnet-4-20250514",
      tokenUsage: { input: 250, output: 25 },
    });

    // Verify both conversation files exist and have correct structure
    const entries1 = parseJsonl(await readFile(logger1.getFilePath(), "utf8"));
    const entries2 = parseJsonl(await readFile(logger2.getFilePath(), "utf8"));

    expect(entries1).toHaveLength(3);
    expect(entries1[0]!.jobId).toBe("job-dm-1");
    expect(entries1[1]!.content).toBe("The answer to 2+2 is 4.");

    expect(entries2).toHaveLength(2);
    expect(entries2[0]!.jobId).toBe("job-dm-2");
    expect(entries2[1]!.content).toBe("Sure! 2+2=4 and 3+3=6.");

    expect(entries1[0]!.sessionId).not.toBe(entries2[0]!.sessionId);
  });
});
