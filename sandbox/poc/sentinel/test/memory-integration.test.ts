import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import "./helpers.ts";
import { writeNote } from "@shepherdjerred/sentinel/memory/index.ts";
import { buildMemoryContext } from "@shepherdjerred/sentinel/memory/context.ts";
import { createConversationLogger } from "@shepherdjerred/sentinel/history/index.ts";
import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";
import type { Note } from "@shepherdjerred/sentinel/memory/note.ts";

const testAgent: AgentDefinition = {
  name: "test-agent",
  description: "Test agent",
  systemPrompt: "You are a test agent.",
  tools: ["Read"],
  maxTurns: 5,
  permissionTier: "read-only",
  triggers: [],
  memory: { private: "test-agent", shared: ["shared"] },
};

describe("memory integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "sentinel-memory-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("builds memory context with private and shared markers", async () => {
    const privateNote: Note = {
      path: path.join(tempDir, "agents", "test-agent", "MEMORY.md"),
      title: "Agent Memory",
      tags: [],
      body: "PRIVATE_MARKER_abc123",
      mtime: new Date(),
    };
    await writeNote(privateNote.path, privateNote);

    const sharedNote: Note = {
      path: path.join(tempDir, "shared", "test-knowledge.md"),
      title: "Test Knowledge",
      tags: ["testing"],
      body: "SHARED_MARKER_xyz789 kubernetes deployment guide",
      mtime: new Date(),
    };
    await writeNote(sharedNote.path, sharedNote);

    const result = await buildMemoryContext(
      testAgent,
      "tell me about kubernetes",
      tempDir,
    );

    expect(result).toContain("## Agent Memory");
    expect(result).toContain("PRIVATE_MARKER_abc123");
    expect(result).toContain("## Relevant Knowledge");
    expect(result).toContain("SHARED_MARKER_xyz789");
  });

  test("system prompt includes memory context same way as worker.ts", async () => {
    const privateNote: Note = {
      path: path.join(tempDir, "agents", "test-agent", "MEMORY.md"),
      title: "Agent Memory",
      tags: [],
      body: "PRIVATE_MARKER_abc123",
      mtime: new Date(),
    };
    await writeNote(privateNote.path, privateNote);

    const sharedNote: Note = {
      path: path.join(tempDir, "shared", "test-knowledge.md"),
      title: "Test Knowledge",
      tags: ["testing"],
      body: "SHARED_MARKER_xyz789 kubernetes deployment guide",
      mtime: new Date(),
    };
    await writeNote(sharedNote.path, sharedNote);

    const memoryContext = await buildMemoryContext(
      testAgent,
      "tell me about kubernetes",
      tempDir,
    );
    const systemPrompt =
      memoryContext.length > 0
        ? `${testAgent.systemPrompt}\n\n${memoryContext}`
        : testAgent.systemPrompt;

    expect(systemPrompt).toContain("You are a test agent.");
    expect(systemPrompt).toContain("PRIVATE_MARKER_abc123");
    expect(systemPrompt).toContain("SHARED_MARKER_xyz789");
  });

  test("JSONL log preserves memory markers in system prompt", async () => {
    const privateNote: Note = {
      path: path.join(tempDir, "agents", "test-agent", "MEMORY.md"),
      title: "Agent Memory",
      tags: [],
      body: "PRIVATE_MARKER_abc123",
      mtime: new Date(),
    };
    await writeNote(privateNote.path, privateNote);

    const sharedNote: Note = {
      path: path.join(tempDir, "shared", "test-knowledge.md"),
      title: "Test Knowledge",
      tags: ["testing"],
      body: "SHARED_MARKER_xyz789 kubernetes deployment guide",
      mtime: new Date(),
    };
    await writeNote(sharedNote.path, sharedNote);

    const memoryContext = await buildMemoryContext(
      testAgent,
      "tell me about kubernetes",
      tempDir,
    );
    const systemPrompt = `${testAgent.systemPrompt}\n\n${memoryContext}`;

    const logger = createConversationLogger(
      "test-agent",
      "job-123",
      "session-456",
      tempDir,
    );

    await logger.appendEntry({
      timestamp: new Date().toISOString(),
      sessionId: "session-456",
      agent: "test-agent",
      jobId: "job-123",
      role: "system",
      content: systemPrompt,
      turnNumber: 0,
      metadata: { type: "system_prompt" },
    });

    const raw = await readFile(logger.getFilePath(), "utf8");
    const firstLine = raw.split("\n").find((line) => line.trim().length > 0);
    expect(firstLine).toBeDefined();

    const parsed = z
      .object({
        content: z.string(),
        metadata: z.object({ type: z.string() }),
      })
      .parse(JSON.parse(firstLine ?? "{}"));
    expect(parsed.content).toContain("PRIVATE_MARKER_abc123");
    expect(parsed.content).toContain("SHARED_MARKER_xyz789");
    expect(parsed.metadata.type).toBe("system_prompt");
  });

  test("returns empty string when memory directory is empty", async () => {
    const result = await buildMemoryContext(testAgent, "some query", tempDir);
    expect(result).toBe("");
  });

  test("budget constraint limits shared knowledge when private memory is large", async () => {
    const largeBody = "kubernetes ".repeat(300).trim();

    const privateNote: Note = {
      path: path.join(tempDir, "agents", "test-agent", "MEMORY.md"),
      title: "Agent Memory",
      tags: [],
      body: largeBody,
      mtime: new Date(),
    };
    await writeNote(privateNote.path, privateNote);

    const sharedNote: Note = {
      path: path.join(tempDir, "shared", "k8s-guide.md"),
      title: "Kubernetes Guide",
      tags: ["kubernetes"],
      body: "kubernetes shared knowledge section with details about pods and services "
        .repeat(50)
        .trim(),
      mtime: new Date(),
    };
    await writeNote(sharedNote.path, sharedNote);

    const result = await buildMemoryContext(
      testAgent,
      "tell me about kubernetes",
      tempDir,
    );

    const privateSection = "## Agent Memory\n" + largeBody;
    expect(result.length).toBeLessThan(privateSection.length + 4000);
  });
});
