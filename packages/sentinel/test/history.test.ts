import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ConversationLogger,
  createConversationLogger,
} from "@shepherdjerred/sentinel/history/index.ts";
import type {
  ConversationEntry,
  SessionSummary,
} from "@shepherdjerred/sentinel/types/history.ts";
import { z } from "zod";

const EntrySchema = z.object({
  timestamp: z.string(),
  sessionId: z.string(),
  agent: z.string(),
  jobId: z.string(),
  role: z.string(),
  content: z.string(),
  toolName: z.string().optional(),
  turnNumber: z.number(),
});

const SummarySchema = z.object({
  totalTurns: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
});

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "sentinel-history-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeEntry(
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry {
  return {
    timestamp: "2026-02-22T14:30:00.000Z",
    sessionId: "sess-1",
    agent: "ci-fixer",
    jobId: "job-1",
    role: "user",
    content: "Check CI status",
    turnNumber: 1,
    ...overrides,
  };
}

function parseLine(line: string): z.infer<typeof EntrySchema> {
  return EntrySchema.parse(JSON.parse(line));
}

describe("ConversationLogger", () => {
  test("creates correct directory structure", async () => {
    const logger = new ConversationLogger(
      "ci-fixer",
      "job-1",
      "sess-1",
      tempDir,
    );
    await logger.appendEntry(makeEntry());

    const filePath = logger.getFilePath();
    expect(filePath).toContain(path.join("conversations", "ci-fixer"));
    expect(filePath).toEndWith(".jsonl");

    const contents = await readFile(filePath, "utf8");
    expect(contents.length).toBeGreaterThan(0);
  });

  test("file path follows naming convention", () => {
    const logger = new ConversationLogger(
      "ci-fixer",
      "job-1",
      "sess-abc",
      tempDir,
    );
    const filePath = logger.getFilePath();
    expect(filePath).toContain("_sess-abc.jsonl");
  });

  test("appends valid JSONL lines", async () => {
    const logger = new ConversationLogger(
      "ci-fixer",
      "job-1",
      "sess-1",
      tempDir,
    );
    await logger.appendEntry(makeEntry());

    const contents = await readFile(logger.getFilePath(), "utf8");
    const lines = contents.trimEnd().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = parseLine(lines[0]!);
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("Check CI status");
    expect(parsed.agent).toBe("ci-fixer");
  });

  test("multiple entries append correctly", async () => {
    const logger = new ConversationLogger(
      "ci-fixer",
      "job-1",
      "sess-1",
      tempDir,
    );

    await logger.appendEntry(
      makeEntry({ turnNumber: 1, role: "user", content: "first" }),
    );
    await logger.appendEntry(
      makeEntry({ turnNumber: 2, role: "assistant", content: "second" }),
    );
    await logger.appendEntry(
      makeEntry({
        turnNumber: 3,
        role: "tool_use",
        content: "third",
        toolName: "Bash",
      }),
    );

    const contents = await readFile(logger.getFilePath(), "utf8");
    const lines = contents.trimEnd().split("\n");
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const parsed = parseLine(line);
      expect(parsed.sessionId).toBe("sess-1");
    }

    const third = parseLine(lines[2]!);
    expect(third.toolName).toBe("Bash");
  });

  test("truncates content exceeding max length", async () => {
    const logger = new ConversationLogger(
      "ci-fixer",
      "job-1",
      "sess-1",
      tempDir,
    );
    const longContent = "x".repeat(150_000);

    await logger.appendEntry(makeEntry({ content: longContent }));

    const contents = await readFile(logger.getFilePath(), "utf8");
    const parsed = parseLine(contents.trimEnd());
    expect(parsed.content.length).toBeLessThan(longContent.length);
    expect(parsed.content).toContain("[truncated, original size: 150000]");
    expect(parsed.content.length).toBeLessThanOrEqual(100_000 + 50);
  });

  test("writes summary with role system", async () => {
    const logger = new ConversationLogger(
      "ci-fixer",
      "job-1",
      "sess-1",
      tempDir,
    );

    const summary: SessionSummary = {
      totalTurns: 10,
      totalInputTokens: 5000,
      totalOutputTokens: 3000,
      durationMs: 45_000,
      outcome: "completed",
    };

    await logger.writeSummary(summary);

    const contents = await readFile(logger.getFilePath(), "utf8");
    const parsed = parseLine(contents.trimEnd());
    expect(parsed.role).toBe("system");

    const summaryData = SummarySchema.parse(JSON.parse(parsed.content));
    expect(summaryData.totalTurns).toBe(10);
    expect(summaryData.outcome).toBe("completed");
  });

  test("handles special characters in content", async () => {
    const logger = new ConversationLogger(
      "ci-fixer",
      "job-1",
      "sess-1",
      tempDir,
    );
    const specialContent = 'line1\nline2\ttab\r\n"quoted"\\backslash';

    await logger.appendEntry(makeEntry({ content: specialContent }));

    const contents = await readFile(logger.getFilePath(), "utf8");
    const lines = contents.trimEnd().split("\n");
    // JSON.stringify escapes newlines, so the entire entry is still one line
    expect(lines).toHaveLength(1);

    const parsed = parseLine(lines[0]!);
    expect(parsed.content).toBe(specialContent);
  });

  test("createConversationLogger factory function", () => {
    const logger = createConversationLogger(
      "health-checker",
      "job-2",
      "sess-2",
      tempDir,
    );
    expect(logger).toBeInstanceOf(ConversationLogger);
    expect(logger.getFilePath()).toContain("health-checker");
    expect(logger.getFilePath()).toContain("sess-2");
  });
});
