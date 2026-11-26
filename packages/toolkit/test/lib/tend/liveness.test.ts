import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectLivenessSnapshot } from "#lib/tend/liveness.ts";
import type { CommandRunner, OsProcessEntry } from "#lib/tend/types.ts";

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tend-liveness-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const notFoundRunner: CommandRunner = () =>
  Promise.resolve({ exitCode: 127, stdout: "", stderr: "not found" });

describe("collectLivenessSnapshot", () => {
  it("filters remote hc terminals, protects local cwds + herdr active files, and holds postgres + processes on databases/testing Forum notice", async () => {
    const homeDir = await makeTempHome();
    const activeDir = path.join(
      homeDir,
      ".local",
      "state",
      "herdr-worktree",
      "active",
    );
    await mkdir(activeDir, { recursive: true });
    await Bun.write(
      path.join(activeDir, "run-1.json"),
      JSON.stringify({
        pid: 700,
        path: "/Users/jerred/.herdr/worktrees/monorepo/active-wt",
      }),
    );

    const runner: CommandRunner = (argv) => {
      if (argv[0] === "tailscale" && argv[1] === "status") {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            Self: {
              HostName: "karpathy",
              DNSName: "karpathy.tailnet-1a49.ts.net.",
            },
          }),
          stderr: "",
        });
      }
      if (argv[0] === "hc" && argv[1] === "ls") {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            terminals: [
              {
                address: "karpathy/t1a",
                state: "live",
                cwd: "/Users/jerred/git/monorepo",
                foreground: {
                  cwd: "/Users/jerred/.herdr/worktrees/monorepo/live-wt",
                  pid: 500,
                },
              },
              {
                address: "macbook/t9z",
                state: "live",
                cwd: "/Users/jerred/.herdr/worktrees/monorepo/remote-only-wt",
                pid: 999,
              },
            ],
          }),
          stderr: "",
        });
      }
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
    };

    const processesOverride = new Map<number, OsProcessEntry>([
      [
        500,
        {
          pid: 500,
          ppid: 1,
          processStart: "Mon Nov 15 10:00:00 2026",
          elapsedSeconds: 1200,
          command: "zsh",
          args: "zsh",
          cwd: "/Users/jerred/.herdr/worktrees/monorepo/live-wt",
        },
      ],
      [
        501,
        {
          pid: 501,
          ppid: 500,
          processStart: "Mon Nov 15 10:01:00 2026",
          elapsedSeconds: 600,
          command: "bun",
          args: "bun test",
        },
      ],
      [
        700,
        {
          pid: 700,
          ppid: 1,
          processStart: "Mon Nov 15 10:05:00 2026",
          elapsedSeconds: 300,
          command: "claude",
          args: "claude",
        },
      ],
    ]);

    const snapshot = await collectLivenessSnapshot({
      runner,
      homeDir,
      hostname: "karpathy.local",
      platform: "darwin",
      nowMs: Date.parse("2026-11-15T20:00:00Z"),
      processesOverride,
      fetchForumNotices: () =>
        Promise.resolve([
          {
            id: "notice-media-qual",
            title: "Media live-dependency qualification on karpathy",
            body: "Holding Postgres and Temporal fixtures under /tmp/media-pg-qual-1",
            scopes: ["host/karpathy", "databases", "testing"],
            state: "open",
            expired: false,
            expiresAt: "2026-11-16T20:00:00Z",
            creator: {
              metadata: {
                worktree:
                  "/Users/jerred/.herdr/worktrees/monorepo/media-qual-wt",
              },
            },
          },
          {
            id: "notice-other-host",
            title: "Desktop experiment",
            body: "On /Users/jerred/other",
            scopes: ["host/jerred-desktop", "databases"],
            state: "open",
            expired: false,
          },
        ]),
    });

    expect(snapshot.localHost).toBe("karpathy");
    expect(snapshot.hcAvailable).toBe(true);
    expect(snapshot.hcTerminals).toHaveLength(1);
    expect(
      snapshot.protectedPaths.has(
        "/Users/jerred/.herdr/worktrees/monorepo/live-wt",
      ),
    ).toBe(true);
    expect(
      snapshot.protectedPaths.has(
        "/Users/jerred/.herdr/worktrees/monorepo/remote-only-wt",
      ),
    ).toBe(false);
    expect(
      snapshot.protectedPaths.has(
        "/Users/jerred/.herdr/worktrees/monorepo/active-wt",
      ),
    ).toBe(true);
    expect(snapshot.protectedPaths.has("/private/tmp/media-pg-qual-1")).toBe(
      true,
    );
    expect(
      snapshot.protectedPaths.has(
        "/Users/jerred/.herdr/worktrees/monorepo/media-qual-wt",
      ),
    ).toBe(true);
    expect(snapshot.holdSurfaces.get("postgres")).toContain(
      "notice-media-qual",
    );
    expect(snapshot.holdSurfaces.get("processes")).toContain(
      "notice-media-qual",
    );
    expect(snapshot.holdSurfaces.has("worktrees")).toBe(false);
    expect(snapshot.liveTerminalRelatedPids).toEqual(new Set([500, 501]));
  });

  it("fails safe by holding worktrees, postgres, and processes when Forum query fails unless --offline is set", async () => {
    const homeDir = await makeTempHome();

    const failedOnline = await collectLivenessSnapshot({
      runner: notFoundRunner,
      homeDir,
      hostname: "macbook",
      platform: "darwin",
      processesOverride: new Map(),
      fetchForumNotices: () => Promise.reject(new Error("tracker timeout")),
    });

    expect(failedOnline.hcAvailable).toBe(false);
    expect(failedOnline.forumAvailable).toBe(false);
    expect(failedOnline.holdSurfaces.has("worktrees")).toBe(true);
    expect(failedOnline.holdSurfaces.has("dedupe")).toBe(true);
    expect(failedOnline.holdSurfaces.has("postgres")).toBe(true);
    expect(failedOnline.holdSurfaces.has("processes")).toBe(true);

    const failedOffline = await collectLivenessSnapshot({
      runner: notFoundRunner,
      homeDir,
      hostname: "macbook",
      platform: "darwin",
      offline: true,
      processesOverride: new Map(),
      fetchForumNotices: () => Promise.reject(new Error("tracker timeout")),
    });

    expect(failedOffline.holdSurfaces.size).toBe(0);
    expect(failedOffline.warnings.some((w) => w.includes("--offline"))).toBe(
      true,
    );
  });
});
