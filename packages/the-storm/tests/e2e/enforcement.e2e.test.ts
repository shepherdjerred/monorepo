import { randomBytes } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Bot } from "mineflayer";
import { connectBot, disconnectBot, waitForMessage } from "./harness/bot.ts";
import { waitForDecision } from "./harness/decisions.ts";
import { startFakeBrain, type FakeBrain } from "./harness/fake-brain.ts";
import { RconClient } from "@shepherdjerred/the-storm-brain/rcon";
import {
  startServer,
  stormTestConfig,
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
  let brain: FakeBrain;
  let server: StartedServer;
  let info: ServerInfo;
  let bot: Bot;
  let rcon: RconClient;

  beforeAll(async () => {
    const token = randomBytes(24).toString("hex");
    brain = startFakeBrain(token);
    server = await startServer({
      // Apart from the shared suite's cache: this boot must not disturb the
      // shared server's staging, and the shared boot must not disturb this one.
      cacheDir: path.join(packageRoot, ".cache", "e2e-active"),
      bootTimeoutMs: 180_000,
      warmCache: Bun.env["STORM_E2E_COLD"] !== "1",
      stormJar,
      stormConfig: stormTestConfig(await Bun.file(ownedConfig).text(), [
        "tickets",
        "agent",
        "chat",
      ]),
      ownedConfigDir,
      brain: {
        baseUrl: `http://host.docker.internal:${brain.port.toString()}`,
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
    await rcon.command(`op ${bot.username}`);
  }, 200_000);

  afterAll(async () => {
    await disconnectBot(bot);
    rcon.close();
    await server.stop();
    await brain.stop();
  });

  test("repeat bursts climb to rung 1", async () => {
    for (let i = 1; i <= 6; i += 1) {
      bot.chat(`rung burst ${i.toString()}`);
    }
    const first = await waitForDecision(
      bot,
      new RegExp(String.raw`#(\d+) ${bot.username} spam mute .*rung=0`),
    );
    expect(first[0]).not.toContain("shadow");
    expect(Number(first[1] ?? "0")).toBeGreaterThan(0);

    // The mute is real: speech stops with the ladder's receipt.
    bot.chat("can anyone hear this");
    const denial = await waitForMessage(
      bot,
      /You are muted for .*prefilter\/rate/,
    );
    expect(denial[0]).toContain("prefilter/rate");

    // A staff unmute lifts the gag without touching the strike, so the next
    // burst climbs instead of restarting. The opped bot lifts its own mute;
    // RCON never proved it holds the mute permission.
    bot.chat(`/unmute ${bot.username}`);
    await waitForMessage(bot, /You can chat again\./);

    for (let i = 1; i <= 6; i += 1) {
      bot.chat(`rung burst again ${i.toString()}`);
    }
    const second = await waitForDecision(
      bot,
      new RegExp(String.raw`#(\d+) ${bot.username} spam mute .*rung=1`),
    );
    expect(second[0]).not.toContain("shadow");
    expect(Number(second[1] ?? "0")).toBeGreaterThan(Number(first[1] ?? "0"));
  });
});
