import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { rm } from "node:fs/promises";
import {
  buildSessionLogMeta,
  GoalMemory,
  type SessionLogMeta,
} from "./goal-memory.ts";
import type { GoalState } from "./goal-types.ts";

const directories: string[] = [];

function tempMemory(now?: () => Date): GoalMemory {
  const directory = path.join(
    Bun.env.TMPDIR ?? "/tmp",
    `pokemon-goal-memory-${crypto.randomUUID()}`,
  );
  directories.push(directory);
  return new GoalMemory(directory, now);
}

function meta(overrides: Partial<SessionLogMeta> = {}): SessionLogMeta {
  return {
    id: "2026-06-19T12-00-00-000-aaaaaaaa",
    goalId: "aaaaaaaa-0000-0000-0000-000000000000",
    goal: "Reach Petalburg",
    startedAt: "2026-06-19T12:00:00.000Z",
    ...overrides,
  };
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("GoalMemory MEMORY.md", () => {
  test("returns empty string before anything is written", async () => {
    const memory = tempMemory();
    expect(await memory.readMemory()).toBe("");
  });

  test("round-trips a curated write and overwrites (does not append)", async () => {
    const memory = tempMemory();
    await memory.writeMemory("First lesson.");
    expect(await memory.readMemory()).toBe("First lesson.");

    await memory.writeMemory("Rewritten and curated.");
    expect(await memory.readMemory()).toBe("Rewritten and curated.");
  });

  test("rejects empty content so accumulated lessons can't be wiped", async () => {
    const memory = tempMemory();
    await memory.writeMemory("Keep me.");
    await expect(memory.writeMemory("   ")).rejects.toThrow(/empty/);
    expect(await memory.readMemory()).toBe("Keep me.");
  });

  test("rejects content past the cap", async () => {
    const memory = tempMemory();
    await expect(memory.writeMemory("x".repeat(16_001))).rejects.toThrow(
      /too long/,
    );
  });
});

describe("GoalMemory archive-on-write", () => {
  test("snapshots the prior MEMORY.md, and the old text stays grep-able", async () => {
    const memory = tempMemory(() => new Date("2026-06-19T12:30:00.000Z"));
    const first = await memory.writeMemory("Old lesson: Mudkip at Route 102.");
    expect(first.archivedPath).toBeUndefined();

    const second = await memory.writeMemory("New lesson: SAVE before rivals.");
    expect(second.archivedPath).toBeDefined();

    // Current memory is the new content; the old line lives under archived-memory.
    expect(await memory.readMemory()).toContain("SAVE before rivals");
    const hits = await memory.grep("route 102");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toContain("archived-memory/");
  });

  test("an identical rewrite does not archive", async () => {
    const memory = tempMemory();
    await memory.writeMemory("Same text.");
    const again = await memory.writeMemory("Same text.");
    expect(again.archivedPath).toBeUndefined();
    const archive = await memory.list("archived-memory");
    expect(archive).toEqual([]);
  });
});

describe("GoalMemory scoped filesystem", () => {
  test("list root shows MEMORY.md + logs/ + archived-memory/", async () => {
    const memory = tempMemory();
    await memory.writeMemory("v1");
    await memory.writeMemory("v2"); // creates archived-memory/
    await memory.writeSessionLog(meta(), "did things"); // creates logs/

    const entries = await memory.list("");
    const byName = new Map(entries.map((entry) => [entry.name, entry.kind]));
    expect(byName.get("MEMORY.md")).toBe("file");
    expect(byName.get("logs")).toBe("dir");
    expect(byName.get("archived-memory")).toBe("dir");
  });

  test("read round-trips a file and rejects missing/traversal/escape", async () => {
    const memory = tempMemory();
    await memory.writeMemory("hello memory");
    expect(await memory.read("MEMORY.md")).toBe("hello memory");
    // Leading slash is tolerated (resolved inside root).
    expect(await memory.read("/MEMORY.md")).toBe("hello memory");
    await expect(memory.read("nope.md")).rejects.toThrow(/not found/);
    await expect(memory.read("../../etc/passwd")).rejects.toThrow(/escapes/);
  });

  test("grep searches MEMORY.md + logs case-insensitively with path:line", async () => {
    const memory = tempMemory();
    await memory.writeMemory("Roxanne uses Rock types.");
    await memory.writeSessionLog(
      meta({ goal: "Climb the stairs" }),
      "The WARP ARROW staircase tripped me up.",
    );
    const hits = await memory.grep("warp arrow");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toContain("logs/");
    expect(hits[0]?.line).toBeGreaterThan(0);
    expect(hits[0]?.text.toLowerCase()).toContain("warp arrow");

    expect(await memory.grep("rock types")).toHaveLength(1);
    expect(await memory.grep("nothing-here")).toEqual([]);
  });

  test("isMemoryPath only matches MEMORY.md", () => {
    const memory = tempMemory();
    expect(memory.isMemoryPath("MEMORY.md")).toBe(true);
    expect(memory.isMemoryPath("/MEMORY.md")).toBe(true);
    expect(memory.isMemoryPath("logs/x.md")).toBe(false);
    expect(memory.isMemoryPath("../escape")).toBe(false);
  });
});

describe("GoalMemory session logs", () => {
  test("writes a readable, slugged log file with frontmatter", async () => {
    const memory = tempMemory(() => new Date("2026-06-19T12:30:00.000Z"));
    const { id, path: logPath } = await memory.writeSessionLog(
      meta({ goal: "Climb the stairs", status: "completed" }),
      "Pressed UP onto the warp arrow to descend.",
    );
    expect(id).toContain("climb-the-stairs");
    // logPath is relative to the memory root — verify it looks right and is readable.
    expect(logPath).toMatch(/^logs\//);
    const text = await memory.read(logPath);
    expect(text).toContain('goal: "Climb the stairs"');
    expect(text).toContain('status: "completed"');
    expect(text).toContain("warp arrow");

    const logs = await memory.list("logs");
    expect(logs).toHaveLength(1);
    expect(await memory.read(logs[0]?.path ?? "")).toContain("warp arrow");
  });
});

describe("buildSessionLogMeta", () => {
  const state: GoalState = {
    id: "abcdef12-0000-0000-0000-000000000000",
    goal: "Climb the stairs",
    requestedBy: "user-a",
    channelId: "channel",
    startedAt: "2026-06-19T12:30:45.678Z",
    lockedUntil: "2026-06-19T12:35:45.678Z",
    deadline: "2026-06-19T13:00:45.678Z",
    status: "completed",
    finishedAt: "2026-06-19T12:45:00.000Z",
    exitCode: 0,
  };

  test("derives a filesystem-safe, sortable id + carries status/exit", () => {
    const built = buildSessionLogMeta(state);
    expect(built.id).toBe("2026-06-19T12-30-45-678-abcdef12");
    expect(built.id).not.toContain(":");
    expect(built.goal).toBe("Climb the stairs");
    expect(built.status).toBe("completed");
    expect(built.exitCode).toBe(0);
  });
});
