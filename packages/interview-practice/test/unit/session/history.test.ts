import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { listSessions } from "#lib/session/manager.ts";

let testDir: string;

beforeEach(() => {
  testDir = path.join("/tmp", `ip-test-${randomUUID()}`);
  Bun.spawnSync(["mkdir", "-p", path.join(testDir, "sessions")]);
});

afterEach(() => {
  Bun.spawnSync(["rm", "-rf", testDir]);
});

describe("session history", () => {
  test("returns empty array when no sessions", async () => {
    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(0);
  });

  test("lists sessions sorted by startedAt descending", async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    const sessionDir1 = path.join(testDir, "sessions", id1);
    const sessionDir2 = path.join(testDir, "sessions", id2);
    Bun.spawnSync(["mkdir", "-p", sessionDir1]);
    Bun.spawnSync(["mkdir", "-p", sessionDir2]);

    await Bun.write(
      path.join(sessionDir1, "metadata.json"),
      JSON.stringify({
        id: id1,
        type: "leetcode",
        questionId: randomUUID(),
        questionTitle: "Two Sum",
        status: "completed",
        startedAt: "2026-01-10T10:00:00.000Z",
        currentPart: 1,
        language: "ts",
        workspacePath: sessionDir1,
        voiceEnabled: false,
        mode: "text_ai",
        timer: { durationMs: 1_500_000, elapsedMs: 900_000, warningsEmitted: [], lastCheckpointMs: 0 },
        hintsGiven: 1,
        testsRun: 2,
      }),
    );

    await Bun.write(
      path.join(sessionDir2, "metadata.json"),
      JSON.stringify({
        id: id2,
        type: "leetcode",
        questionId: randomUUID(),
        questionTitle: "LRU Cache",
        status: "in-progress",
        startedAt: "2026-01-15T10:00:00.000Z",
        currentPart: 2,
        language: "java",
        workspacePath: sessionDir2,
        voiceEnabled: false,
        mode: "text_ai",
        timer: { durationMs: 1_500_000, elapsedMs: 600_000, warningsEmitted: [], lastCheckpointMs: 0 },
        hintsGiven: 0,
        testsRun: 5,
      }),
    );

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(2);
    // Most recent first
    expect(sessions[0]!.questionTitle).toBe("LRU Cache");
    expect(sessions[1]!.questionTitle).toBe("Two Sum");
  });

  test("skips invalid metadata files", async () => {
    const id = randomUUID();
    const sessionDir = path.join(testDir, "sessions", id);
    Bun.spawnSync(["mkdir", "-p", sessionDir]);

    await Bun.write(
      path.join(sessionDir, "metadata.json"),
      "invalid json {{{",
    );

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(0);
  });
});
