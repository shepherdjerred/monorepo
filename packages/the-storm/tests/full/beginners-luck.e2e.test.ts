import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "#e2e/fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "#e2e/harness/bot.ts";

const Probe = z.object({
  zombieLevel: z.number(),
  creeperLevel: z.number(),
  melee: z.number(),
  ranged: z.number(),
  blast: z.number(),
  normalMelee: z.number(),
  normalRanged: z.number(),
  normalBlast: z.number(),
});

describe("beginner's luck on native Paper", () => {
  test("a fresh active allowance lowers real mob levels and native damage, retaining aggression", async ({
    bot,
    brain,
    rcon,
    server,
    secondBot,
  }) => {
    const host = Bun.env["STORM_E2E_BRAIN_HOST"] ?? "127.0.0.1";
    const response = await fetch(
      `http://${host}:${brain.port.toString()}/v1/__control/beginners`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([bot.player.uuid]),
      },
    );
    expect(response.ok).toBe(true);
    await disconnectBot(bot);
    const player = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: bot.username,
    });
    await disconnectBot(secondBot);
    const veteran = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: secondBot.username,
    });
    try {
      const ready = waitForMessage(
        player,
        /You take 10% of ordinary mob damage/u,
      );
      player.chat("/beginnersluck");
      await ready;
      await rcon.command(
        "execute in minecraft:wilds run fill 2995 64 -5 3005 64 5 minecraft:stone",
      );
      await rcon.command(
        `execute in minecraft:wilds run minecraft:tp ${bot.username} 3000.5 65 0.5`,
      );
      await rcon.command(
        `execute in minecraft:wilds run minecraft:tp ${secondBot.username} 3003.5 65 0.5`,
      );
      await waitUntil(
        "both players arrive in wilds",
        () =>
          Math.abs(player.entity.position.x - 3000.5) < 1 &&
          Math.abs(veteran.entity.position.x - 3003.5) < 1,
      );
      const result = Probe.parse(
        JSON.parse(
          await rcon.command(
            `storm-fixture-beginners ${bot.username} ${secondBot.username}`,
          ),
        ),
      );
      expect(result.zombieLevel).toBe(1);
      expect(result.creeperLevel).toBe(1);
      expect(result.melee).toBeGreaterThan(0);
      expect(result.melee).toBeLessThan(1);
      expect(result.normalMelee, JSON.stringify(result)).toBeGreaterThan(0);
      expect(result.melee / result.normalMelee).toBeCloseTo(0.1, 4);
      expect(result.ranged / result.normalRanged).toBeCloseTo(0.1, 4);
      expect(result.blast / result.normalBlast).toBeCloseTo(0.1, 4);
    } finally {
      await disconnectBot(player);
      await disconnectBot(veteran);
      const reset = await fetch(
        `http://${host}:${brain.port.toString()}/v1/__control/beginners`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "[]",
        },
      );
      expect(reset.ok).toBe(true);
    }
  }, 90_000);
});
