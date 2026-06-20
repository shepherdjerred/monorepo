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

async function tempMemory(now?: () => Date): Promise<GoalMemory> {
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
    const memory = await tempMemory();
    expect(await memory.readMemory()).toBe("");
  });

  test("round-trips a curated write and overwrites (does not append)", async () => {
    const memory = await tempMemory();
    await memory.writeMemory("First lesson.");
    expect(await memory.readMemory()).toBe("First lesson.");

    await memory.writeMemory("Rewritten and curated.");
    const text = await memory.readMemory();
    expect(text).toBe("Rewritten and curated.");
    expect(text).not.toContain("First lesson.");
  });

  test("rejects empty content so accumulated lessons can't be wiped", async () => {
    const memory = await tempMemory();
    await memory.writeMemory("Keep me.");
    await expect(memory.writeMemory("   ")).rejects.toThrow(/empty/);
    expect(await memory.readMemory()).toBe("Keep me.");
  });

  test("rejects content past the cap", async () => {
    const memory = await tempMemory();
    await expect(memory.writeMemory("x".repeat(16_001))).rejects.toThrow(
      /too long/,
    );
  });
});

describe("GoalMemory session logs", () => {
  test("writes a log with frontmatter + reflection body", async () => {
    const memory = await tempMemory(() => new Date("2026-06-19T12:30:00.000Z"));
    const { id, path: logPath } = await memory.writeSessionLog(
      meta(),
      "Did X. Hard part: stairs. Learned: press UP onto warp arrows.",
    );
    expect(id).toBe("2026-06-19T12-00-00-000-aaaaaaaa");
    const text = await Bun.file(logPath).text();
    expect(text).toContain('goal: "Reach Petalburg"');
    expect(text).toContain('written: "2026-06-19T12:30:00.000Z"');
    expect(text).toContain("Hard part: stairs.");
  });

  test("rewriting the same session id refines one file (idempotent)", async () => {
    const memory = await tempMemory();
    await memory.writeSessionLog(meta(), "draft");
    await memory.writeSessionLog(meta(), "final reflection");
    const logs = await memory.listSessionLogs(10);
    expect(logs).toHaveLength(1);
    expect(await memory.readSessionLog(logs[0]?.id)).toContain(
      "final reflection",
    );
  });

  test("lists newest first and honors the limit", async () => {
    const memory = await tempMemory();
    await memory.writeSessionLog(
      meta({ id: "2026-06-19T10-00-00-000-aaaaaaaa", goal: "Older" }),
      "older",
    );
    await memory.writeSessionLog(
      meta({ id: "2026-06-19T11-00-00-000-bbbbbbbb", goal: "Newer" }),
      "newer",
    );
    const all = await memory.listSessionLogs(10);
    expect(all.map((entry) => entry.goal)).toEqual(["Newer", "Older"]);
    expect(await memory.listSessionLogs(1)).toHaveLength(1);
  });

  test("searches log bodies case-insensitively with a snippet", async () => {
    const memory = await tempMemory();
    await memory.writeSessionLog(
      meta({ id: "2026-06-19T10-00-00-000-aaaaaaaa", goal: "Stairs goal" }),
      "The WARP ARROW staircase tripped me up.",
    );
    await memory.writeSessionLog(
      meta({ id: "2026-06-19T11-00-00-000-bbbbbbbb", goal: "Catch goal" }),
      "Threw three poke balls.",
    );
    const hits = await memory.searchSessionLogs("warp arrow", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.goal).toBe("Stairs goal");
    expect(hits[0]?.snippet.toLowerCase()).toContain("warp arrow");
  });

  test("read rejects path traversal ids", async () => {
    const memory = await tempMemory();
    await expect(memory.readSessionLog("../../etc/passwd")).rejects.toThrow(
      /invalid session log id/,
    );
  });

  test("list/search are empty before any log exists", async () => {
    const memory = await tempMemory();
    expect(await memory.listSessionLogs(5)).toEqual([]);
    expect(await memory.searchSessionLogs("anything", 5)).toEqual([]);
  });

  test("rejects empty reflection content", async () => {
    const memory = await tempMemory();
    await expect(memory.writeSessionLog(meta(), "  ")).rejects.toThrow(/empty/);
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
    status: "running",
  };

  test("derives a filesystem-safe, sortable id from start time + goal id", () => {
    const built = buildSessionLogMeta(state);
    expect(built.id).toBe("2026-06-19T12-30-45-678-abcdef12");
    expect(built.id).not.toContain(":");
    expect(built.goalId).toBe(state.id);
    expect(built.goal).toBe("Climb the stairs");
    expect(built.startedAt).toBe(state.startedAt);
  });

  test("the built meta round-trips through writeSessionLog → list/read", async () => {
    const memory = await tempMemory();
    const { id } = await memory.writeSessionLog(
      buildSessionLogMeta(state),
      "Pressed UP onto the warp arrow to descend.",
    );
    const logs = await memory.listSessionLogs(5);
    expect(logs[0]?.id).toBe(id);
    expect(logs[0]?.goal).toBe("Climb the stairs");
    expect(await memory.readSessionLog(id)).toContain("warp arrow");
  });
});
