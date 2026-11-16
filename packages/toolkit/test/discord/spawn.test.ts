import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { pathExists } from "@shepherdjerred/unix-socket-daemon";
import {
  awaitDiscordDaemonReady,
  discordDaemonLogPath,
  hasAutoStartDiscordTokens,
} from "#lib/discord/spawn.ts";

describe("discord daemon spawn helpers", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir !== "") {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("detects whether auto-start Discord tokens are present", () => {
    expect(hasAutoStartDiscordTokens({})).toBe(false);
    expect(hasAutoStartDiscordTokens({ DISCORD_BOT_TOKEN: "" })).toBe(false);
    expect(hasAutoStartDiscordTokens({ DISCORD_BOT_TOKEN: "bot-token" })).toBe(
      true,
    );
    expect(
      hasAutoStartDiscordTokens({ DISCORD_USER_TOKEN: "user-token" }),
    ).toBe(true);
  });

  test("awaitDiscordDaemonReady reports early child exit with log path", async () => {
    await expect(awaitDiscordDaemonReady(() => 1, 1000)).rejects.toThrow(
      `Daemon exited early with code 1. Logs: ${discordDaemonLogPath()}`,
    );
  });

  test("discord daemon status cleans leftover dead state.json and daemon.sock", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "toolkit-discord-stale-"));
    const deadChild = Bun.spawn(["true"]);
    await deadChild.exited;

    const socketPath = path.join(tempDir, "daemon.sock");
    const statePath = path.join(tempDir, "state.json");
    await writeFile(socketPath, "dead-socket", "utf8");
    await writeFile(
      statePath,
      JSON.stringify({
        pid: deadChild.pid,
        startedAt: "2026-06-12T00:00:00.000Z",
        ttlSeconds: 3600,
        identities: {},
      }),
      "utf8",
    );

    const statusProc = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "../../src/index.ts"),
        "discord",
        "daemon",
        "status",
      ],
      {
        env: {
          PATH: Bun.env["PATH"],
          HOME: tempDir,
          TOOLKIT_DISCORD_DIR: tempDir,
          DISCORD_BOT_TOKEN: "fixture-bot-token",
          DISCORD_USER_TOKEN: "fixture-user-token",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, code] = await Promise.all([
      new Response(statusProc.stdout).text(),
      statusProc.exited,
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain("Discord daemon is not running.");
    expect(await pathExists(socketPath)).toBe(false);
    expect(await pathExists(statePath)).toBe(false);
  });
});
