import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./fixtures.ts";
import { disconnectBot, waitForMessage } from "./harness/bot.ts";

const EventsSchema = z.array(
  z.object({
    uuid: z.uuid(),
    event: z.string(),
    distinct_id: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
);

async function captured(port: number, player: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `http://127.0.0.1:${port.toString()}/v1/__control/analytics`,
    );
    const seen = EventsSchema.parse(await response.json()).filter(
      (event) => event.distinct_id === `the-storm:prod:player:${player}`,
    );
    if (seen.some((event) => event.event === "storm_session_ended"))
      return seen;
    await Bun.sleep(50);
  }
  throw new Error("Durable analytics batch was not delivered after quit");
}

describe("Minecraft product analytics", () => {
  test("captures a human connection, successful balance view, AFK time and disconnect", async ({
    bot,
    rcon,
    brain,
  }) => {
    await rcon.command(`op ${bot.username}`);
    const viewed = waitForMessage(bot, /crystals/iu);
    bot.chat("/balance");
    await viewed;
    const away = waitForMessage(bot, /AFK/u);
    bot.chat("/afk");
    await away;
    await Bun.sleep(1200);
    const player = bot.player.uuid;
    await disconnectBot(bot);
    const seen = await captured(brain.port, player);
    expect(
      seen.filter((event) => event.event === "storm_session_started"),
    ).toHaveLength(1);
    expect(
      seen.some(
        (event) =>
          event.event === "storm_feature_interacted" &&
          event.properties["action"] === "balance_viewed",
      ),
    ).toBe(true);
    const end = seen.find((event) => event.event === "storm_session_ended");
    const connected = z.number().parse(end?.properties["connected_ms"]);
    const active = z.number().parse(end?.properties["active_ms"]);
    expect(connected).toBeGreaterThan(active);
    expect(connected - active).toBeGreaterThanOrEqual(1000);
    expect(
      seen.every(
        (event) =>
          event.properties["source"] === "minecraft" &&
          event.properties["$geoip_disable"] === true,
      ),
    ).toBe(true);
    expect(
      seen.every((event) => event.properties["event_id"] === event.uuid),
    ).toBe(true);
    expect(
      seen.some((event) => JSON.stringify(event).includes("/balance")),
    ).toBe(false);
  });
});
