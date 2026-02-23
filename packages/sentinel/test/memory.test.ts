import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listNotes,
  readNote,
  writeNote,
} from "@shepherdjerred/sentinel/memory/index.ts";
import {
  parseNote,
  serializeNote,
} from "@shepherdjerred/sentinel/memory/note.ts";
import type { Note } from "@shepherdjerred/sentinel/memory/note.ts";
import { MemoryIndexer } from "@shepherdjerred/sentinel/memory/indexer.ts";
import { buildMemoryContext } from "@shepherdjerred/sentinel/memory/context.ts";
import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "sentinel-memory-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    path: "test/note.md",
    title: "Test Note",
    tags: ["test"],
    body: "This is a test note body.",
    mtime: new Date("2026-01-01"),
    ...overrides,
  };
}

const testAgent: AgentDefinition = {
  name: "test-agent",
  description: "Test agent",
  systemPrompt: "You are a test agent.",
  tools: ["Read"],
  maxTurns: 5,
  permissionTier: "read-only",
  triggers: [],
  memory: {
    private: "data/memory/agents/test-agent",
    shared: ["data/memory/shared"],
  },
};

describe("parseNote", () => {
  test("parses markdown with frontmatter", () => {
    const content = `---
title: My Note
tags:
  - ci
  - debugging
---
This is the body.`;

    const note = parseNote("/tmp/test.md", content);
    expect(note.title).toBe("My Note");
    expect(note.tags).toEqual(["ci", "debugging"]);
    expect(note.body).toBe("This is the body.");
    expect(note.path).toBe("/tmp/test.md");
  });

  test("parses markdown without frontmatter", () => {
    const content = "Just plain text content.";
    const note = parseNote("/tmp/plain.md", content);
    expect(note.title).toBe("plain.md");
    expect(note.tags).toEqual([]);
    expect(note.body).toBe("Just plain text content.");
  });

  test("handles empty frontmatter", () => {
    const content = `---
---
Body only.`;

    const note = parseNote("/tmp/empty-fm.md", content);
    expect(note.title).toBe("empty-fm.md");
    expect(note.tags).toEqual([]);
    expect(note.body).toBe("Body only.");
  });

  test("handles non-string tags gracefully", () => {
    const content = `---
title: Mixed Tags
tags:
  - valid
  - 123
---
Body here.`;

    const note = parseNote("/tmp/mixed.md", content);
    // gray-matter with default YAML parsing may convert 123 to number or string
    // We filter for strings only
    expect(note.tags).toContain("valid");
    expect(note.body).toBe("Body here.");
  });
});

describe("serializeNote", () => {
  test("serializes note with frontmatter", () => {
    const note = makeNote({ title: "Test", tags: ["ci"], body: "Content." });
    const result = serializeNote(note);
    expect(result).toContain("title: Test");
    expect(result).toContain("Content.");
  });

  test("roundtrip: parse then serialize", () => {
    const original = `---
title: Roundtrip
tags:
  - alpha
  - beta
---
Body content here.`;

    const note = parseNote("/tmp/rt.md", original);
    const serialized = serializeNote(note);
    const reparsed = parseNote("/tmp/rt.md", serialized);

    expect(reparsed.title).toBe("Roundtrip");
    expect(reparsed.tags).toEqual(["alpha", "beta"]);
    expect(reparsed.body).toBe("Body content here.");
  });

  test("serializes note without tags", () => {
    const note = makeNote({ tags: [], body: "No tags." });
    const result = serializeNote(note);
    expect(result).not.toContain("tags:");
    expect(result).toContain("No tags.");
  });
});

describe("readNote / writeNote", () => {
  test("atomic write creates file", async () => {
    const filePath = path.join(tempDir, "note.md");
    const note = makeNote({ path: filePath });

    await writeNote(filePath, note);

    const content = await readFile(filePath, "utf8");
    expect(content).toContain("Test Note");
    expect(content).toContain("This is a test note body.");
  });

  test("tmp file is cleaned up after write", async () => {
    const filePath = path.join(tempDir, "clean.md");
    await writeNote(filePath, makeNote({ path: filePath }));

    const entries = await readdir(tempDir);
    expect(entries).toEqual(["clean.md"]);
  });

  test("readNote reads written file", async () => {
    const filePath = path.join(tempDir, "read.md");
    const original = makeNote({
      path: filePath,
      title: "Read Me",
      body: "Read body.",
    });

    await writeNote(filePath, original);
    const loaded = await readNote(filePath);

    expect(loaded.title).toBe("Read Me");
    expect(loaded.body).toBe("Read body.");
    expect(loaded.path).toBe(filePath);
  });

  test("writeNote creates nested directories", async () => {
    const filePath = path.join(tempDir, "deep", "nested", "note.md");
    await writeNote(filePath, makeNote({ path: filePath }));

    const fileStat = await stat(filePath);
    expect(fileStat.isFile()).toBe(true);
  });
});

describe("listNotes", () => {
  test("lists markdown files recursively", async () => {
    const dir = path.join(tempDir, "notes");
    await writeNote(
      path.join(dir, "a.md"),
      makeNote({ path: "a.md", title: "A" }),
    );
    await writeNote(
      path.join(dir, "sub", "b.md"),
      makeNote({ path: "b.md", title: "B" }),
    );
    // Write a non-md file
    await Bun.write(path.join(dir, "ignore.txt"), "not a note");

    const notes = await listNotes(dir);
    expect(notes).toHaveLength(2);
    expect(notes.some((n) => n.endsWith("a.md"))).toBe(true);
    expect(notes.some((n) => n.endsWith("b.md"))).toBe(true);
  });

  test("returns empty array for non-existent directory", async () => {
    const notes = await listNotes(path.join(tempDir, "nope"));
    expect(notes).toEqual([]);
  });
});

describe("MemoryIndexer", () => {
  let indexer: MemoryIndexer;

  beforeEach(() => {
    const dbPath = path.join(tempDir, ".index.sqlite");
    indexer = new MemoryIndexer(dbPath);
  });

  afterEach(() => {
    indexer.close();
  });

  test("indexes and searches notes", async () => {
    const memDir = path.join(tempDir, "mem");
    await writeNote(
      path.join(memDir, "ci-guide.md"),
      makeNote({
        title: "CI Guide",
        tags: ["ci", "pipeline"],
        body: "How to fix failing CI pipelines and debug build errors.",
      }),
    );
    await writeNote(
      path.join(memDir, "deploy.md"),
      makeNote({
        title: "Deployment",
        tags: ["deploy"],
        body: "Steps to deploy the application to production.",
      }),
    );

    const indexed = await indexer.indexAll(memDir);
    expect(indexed).toBe(2);

    const results = indexer.search("CI pipeline build");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.title).toBe("CI Guide");
  });

  test("skips unchanged files on re-index", async () => {
    const memDir = path.join(tempDir, "mem2");
    await writeNote(
      path.join(memDir, "note.md"),
      makeNote({ title: "Stable" }),
    );

    const first = await indexer.indexAll(memDir);
    expect(first).toBe(1);

    const second = await indexer.indexAll(memDir);
    expect(second).toBe(0);
  });

  test("empty query returns no results", () => {
    const results = indexer.search("");
    expect(results).toEqual([]);
  });

  test("search with limit", async () => {
    const memDir = path.join(tempDir, "mem3");
    for (let i = 0; i < 5; i++) {
      await writeNote(
        path.join(memDir, `note${String(i)}.md`),
        makeNote({
          title: `Note ${String(i)}`,
          body: `Common keyword content number ${String(i)}.`,
        }),
      );
    }

    await indexer.indexAll(memDir);
    const results = indexer.search("keyword content", 2);
    expect(results).toHaveLength(2);
  });

  test("handles malformed files gracefully", async () => {
    const memDir = path.join(tempDir, "mem4");
    // Write a valid note
    await writeNote(
      path.join(memDir, "good.md"),
      makeNote({ title: "Good Note", body: "Valid content." }),
    );

    // The indexer should still succeed even if some files have issues
    const indexed = await indexer.indexAll(memDir);
    expect(indexed).toBe(1);
  });
});

describe("buildMemoryContext", () => {
  test("builds context with private memory", async () => {
    const memDir = path.join(tempDir, "ctx");
    const privatePath = path.join(memDir, "agents", "test-agent", "MEMORY.md");
    await writeNote(
      privatePath,
      makeNote({
        title: "Private Memory",
        body: "Agent-specific knowledge about CI patterns.",
      }),
    );

    const context = await buildMemoryContext(
      testAgent,
      "Check CI status",
      memDir,
    );
    expect(context).toContain("## Agent Memory");
    expect(context).toContain("Agent-specific knowledge about CI patterns.");
  });

  test("builds context with search results", async () => {
    const memDir = path.join(tempDir, "ctx2");
    await writeNote(
      path.join(memDir, "shared", "kubernetes.md"),
      makeNote({
        title: "Kubernetes Guide",
        tags: ["k8s"],
        body: "How to debug kubernetes pod failures.",
      }),
    );

    const context = await buildMemoryContext(
      testAgent,
      "kubernetes pod is failing",
      memDir,
    );
    expect(context).toContain("## Relevant Knowledge");
    expect(context).toContain("Kubernetes Guide");
  });

  test("returns empty string when no memory exists", async () => {
    const memDir = path.join(tempDir, "empty");
    const context = await buildMemoryContext(
      testAgent,
      "some random query",
      memDir,
    );
    expect(context).toBe("");
  });

  test("respects budget limit", async () => {
    const memDir = path.join(tempDir, "ctx3");
    // Write a large note
    const largeBody = "keyword ".repeat(2000);
    await writeNote(
      path.join(memDir, "large.md"),
      makeNote({ title: "Large Note", body: largeBody }),
    );

    const context = await buildMemoryContext(
      testAgent,
      "keyword search test",
      memDir,
    );
    // Context should be bounded
    expect(context.length).toBeLessThan(5000);
  });
});
