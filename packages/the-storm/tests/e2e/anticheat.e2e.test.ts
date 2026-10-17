import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { waitForMessage, waitUntil } from "./harness/bot.ts";
import { EntityPosOutputSchema } from "./harness/rcon-output.ts";

describe("Grim detection with corrections disabled", () => {
  test("records an actual client's impossible upward movement with client and ping evidence", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`op ${secondBot.username}`);
    await rcon.command(`minecraft:tp ${bot.username} 750 80 750`);
    await waitUntil("teleport acknowledged", () => bot.entity.position.y > 79);
    await bot.waitForTicks(25);
    bot.physicsEnabled = false;
    const position = bot.entity.position.clone();
    for (let tick = 1; tick <= 24; tick++) {
      bot._client.write("position", {
        x: position.x,
        y: position.y + tick * 0.4,
        z: position.z,
        flags: { onGround: false, hasHorizontalCollision: false },
      });
      await Bun.sleep(50);
    }
    const evidence = waitForMessage(
      secondBot,
      /^.*anticheat.*client=.*ping=.*$/u,
    );
    secondBot.chat(`/safety search ${bot.username}`);
    const row = await evidence;
    expect(row[0]).toContain("anticheat");
    const serverPosition = EntityPosOutputSchema.parse(
      await rcon.command(`data get entity ${bot.username} Pos`),
    );
    expect(serverPosition.y).toBeGreaterThan(position.y + 1);
    expect(await rcon.command("banlist players")).not.toContain(bot.username);
  });
});
