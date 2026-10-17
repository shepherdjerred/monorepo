import { randomBytes } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Bot } from "mineflayer";
import { connectBot, disconnectBot, waitForMessage } from "./harness/bot.ts";
import { waitForDecision } from "./harness/decisions.ts";
import {
  startFakeBrain,
  setBrainMode,
  type FakeBrain,
} from "./harness/fake-brain.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { stormModuleConfig } from "@shepherdjerred/mc-harness/sandbox/storm.ts";
import {
  startServer,
  type ServerInfo,
  type StartedServer,
} from "./harness/server.ts";
import {
  ownedConfig,
  ownedConfigDir,
  packageRoot,
  stormJar,
} from "./harness/paths.ts";

// The shared suite server watches in shadow mode; enforcement needs teeth,
// so this file boots its own active-mode server. CI runs the suite against a
// sidecar without Docker, so there is nothing to boot against there.
const external = Bun.env["STORM_E2E_HOST"] !== undefined;

function username(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

describe.skipIf(external)("active enforcement", () => {
  let brain: FakeBrain | undefined;
  let server: StartedServer | undefined;
  let info: ServerInfo;
  let bot: Bot;
  let connectedBot: Bot | undefined;
  let rcon: RconClient | undefined;

  beforeAll(async () => {
    const token = randomBytes(24).toString("hex");
    brain = startFakeBrain(token);
    const brainBaseUrl = `http://host.docker.internal:${brain.port.toString()}`;
    server = await startServer({
      // Apart from the shared suite's cache: this boot must not disturb the
      // shared server's staging, and the shared boot must not disturb this one.
      cacheDir: path.join(packageRoot, ".cache", "e2e-active"),
      bootTimeoutMs: 180_000,
      warmCache: Bun.env["STORM_E2E_COLD"] !== "1",
      stormJar,
      stormConfig: stormModuleConfig(await Bun.file(ownedConfig).text(), [
        "tickets",
        "agent",
        "chat",
        "safety",
      ]),
      ownedConfigDir,
      // The plugin's typed flag provider bootstraps even when only moderation runs.
      env: { FLIPT_URL: brainBaseUrl, FLIPT_ENVIRONMENT: "prod" },
      brain: {
        baseUrl: brainBaseUrl,
        token,
      },
      sweep: {
        intervalMinutes: 1,
        redriveAfterMinutes: 0,
        redriveBackoffMinutes: 0,
        slaAfterMinutes: 10_080,
      },
      agent: { mode: "active", reviewSamplePercent: 100 },
    });
    info = server.info;
    if (info.kind !== "container") {
      throw new Error("active enforcement needs a container server");
    }
    rcon = await RconClient.connect({
      host: info.host,
      port: info.rconPort,
      password: info.rconPassword,
    });
    bot = await connectBot({
      host: info.host,
      port: info.gamePort,
      username: username("e"),
    });
    connectedBot = bot;
    await rcon.command(`op ${bot.username}`);
  }, 200_000);

  afterAll(async () => {
    if (connectedBot !== undefined) await disconnectBot(connectedBot);
    rcon?.close();
    if (server !== undefined) await server.stop();
    if (brain !== undefined) await brain.stop();
  });

  test("obvious repeated-link spam is muted and a repeat offense escalates", async () => {
    const blocked = waitForMessage(bot, /not published \(spam\)/);
    for (let i = 1; i <= 3; i += 1) bot.chat("https://example.com");
    await blocked;
    const first = await waitForDecision(
      bot,
      new RegExp(
        String.raw`#(\d+) ${bot.username} spam mute .*safety-block evidence`,
      ),
    );
    expect(first[0]).not.toContain("shadow");
    expect(Number(first[1] ?? "0")).toBeGreaterThan(0);

    // The mute is real even for an operator.
    bot.chat("can anyone hear this");
    const denial = await waitForMessage(
      bot,
      /You are muted or chat state is still loading/,
    );
    expect(denial[0]).toContain("muted");

    // A staff unmute lifts the gag without touching the strike, so the next
    // burst climbs instead of restarting. The opped bot lifts its own mute;
    // RCON never proved it holds the mute permission.
    bot.chat(`/unmute ${bot.username}`);
    await waitForMessage(bot, /You can chat again\./);

    const blockedAgain = waitForMessage(bot, /not published \(spam\)/);
    bot.chat("https://example.com");
    await blockedAgain;
    const second = await waitForDecision(
      bot,
      new RegExp(
        String.raw`#((?!${first[1] ?? "0"}\b)\d+) ${bot.username} spam mute .*safety-block evidence`,
      ),
    );
    expect(second[0]).not.toContain("shadow");
    expect(Number(second[1] ?? "0")).toBeGreaterThan(Number(first[1] ?? "0"));
  });

  test("disabled screening preserves legacy burst enforcement", async () => {
    if (brain === undefined || rcon === undefined)
      throw new Error("Active fixture is missing");
    const legacyBot = await connectBot({
      host: info.host,
      port: info.gamePort,
      username: username("l"),
    });
    try {
      await rcon.command(`op ${legacyBot.username}`);
      await setBrainMode(brain.port, "screening-disabled");
      const decision = waitForDecision(
        legacyBot,
        new RegExp(
          String.raw`#(\d+) ${legacyBot.username} spam mute .*prefilter rung=0.*rung 0: rate`,
        ),
      );
      for (let i = 1; i <= 6; i += 1)
        legacyBot.chat(`legacy burst ${i.toString()}`);
      const matched = await decision;
      expect(matched[0]).not.toContain("shadow");
      const denied = waitForMessage(
        legacyBot,
        /You are muted or chat state is still loading/,
      );
      legacyBot.chat("the legacy mute is enforced");
      await denied;
    } finally {
      await setBrainMode(brain.port, "ok");
      await disconnectBot(legacyBot);
    }
  });
});
