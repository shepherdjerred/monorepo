import path from "node:path";
import { describe, expect } from "vitest";
import { z } from "zod";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { ownedConfigDir } from "#e2e/harness/paths.ts";

const CatalogSchema = z.object({
  sites: z.array(
    z.object({
      name: z.string(),
      profile: z.string(),
      protectedChunks: z.array(
        z.object({ x: z.number().int(), z: z.number().int() }),
      ),
    }),
  ),
});

function coordinates(x: number, y: number, blockZ: number): string {
  return [x, y, blockZ].map((value) => value.toString()).join(" ");
}

describe("historical preservation on real Paper", () => {
  test("spawn and historical sites appear in the public town directory", async ({
    rcon,
  }) => {
    expect(await rcon.command("town list 1")).toContain("Spawn");
    expect(await rcon.command("town info Frost Falls")).toContain(
      "Frost Falls",
    );
    expect(await rcon.command("town info The Colosseum")).toContain(
      "The Colosseum",
    );
    expect(await rcon.command("town list 999")).toContain("page");
  });

  test("spawn resists native decay, fire, explosions and staff trampling while crops mature", async ({
    bot,
    rcon,
  }) => {
    // Both platforms are disposable. x=311 is Spawn; x=335 is outside its boundary.
    for (const x of [311, 335]) {
      await rcon.command(
        `fill ${coordinates(x - 3, 200, 3)} ${coordinates(x + 3, 200, 16)} minecraft:oak_planks`,
      );
      await rcon.command(
        `fill ${coordinates(x - 3, 201, 3)} ${coordinates(x + 3, 206, 16)} air`,
      );
      await rcon.command(
        `setblock ${coordinates(x, 205, 8)} minecraft:oak_leaves[distance=7,persistent=false]`,
      );
      await rcon.command(`setblock ${coordinates(x, 201, 12)} minecraft:fire`);
    }
    await rcon.command("setblock 309 200 7 minecraft:water");
    await rcon.command("setblock 310 200 7 minecraft:farmland[moisture=7]");
    await rcon.command("setblock 310 201 7 minecraft:wheat[age=0]");
    await rcon.command(`op ${bot.username}`);
    try {
      await rcon.command(`tp ${bot.username} 310.5 204 7.5`);
      await waitUntil(
        "staff falls onto the protected crop bed",
        () => bot.entity.position.distanceTo(new Vec3(310.5, 201, 7.5)) < 0.3,
      );
      expect(
        await rcon.command("execute if block 310 200 7 minecraft:farmland"),
      ).toContain("Test passed");
      expect(await rcon.command("gamerule random_tick_speed 4096")).toContain(
        "4096",
      );
      await waitUntil(
        "unprotected leaf decay and fire controls",
        () =>
          bot.blockAt(new Vec3(335, 205, 8))?.name === "air" &&
          bot.blockAt(new Vec3(335, 200, 12))?.name === "air",
        15_000,
      );
      await waitUntil(
        "protected wheat matures",
        () =>
          bot.blockAt(new Vec3(310, 201, 7))?.getProperties()["age"] === "7",
        10_000,
      );
      expect(
        await rcon.command("execute if block 311 205 8 minecraft:oak_leaves"),
      ).toContain("Test passed");
      expect(
        await rcon.command("execute if block 311 200 12 minecraft:oak_planks"),
      ).toContain("Test passed");
      expect(
        await rcon.command("summon minecraft:tnt 311.5 202 12.5"),
      ).toContain("Summoned");
      await Bun.sleep(5000);
      expect(
        await rcon.command(
          "execute if entity @e[type=minecraft:tnt,x=311,y=201,z=12,distance=..10]",
        ),
      ).toContain("Test failed");
      expect(
        await rcon.command("execute if block 311 200 12 minecraft:oak_planks"),
      ).toContain("Test passed");
      expect(
        await rcon.command("execute if block 310 200 7 minecraft:farmland"),
      ).toContain("Test passed");
    } finally {
      await rcon.command("gamerule random_tick_speed 3");
      await rcon.command(`deop ${bot.username}`);
      for (const x of [311, 335]) {
        await rcon.command(
          `fill ${coordinates(x - 3, 200, 3)} ${coordinates(x + 3, 206, 16)} air`,
        );
      }
    }
  }, 45_000);

  test("a native death and respawn keep items and experience when preservation forbids a grave", async ({
    bot,
    rcon,
  }) => {
    const catalog = CatalogSchema.parse(
      Bun.YAML.parse(
        await Bun.file(path.join(ownedConfigDir, "heritage.yml")).text(),
      ),
    );
    const site = catalog.sites.find(
      (value) => value.profile === "SAFE" && value.protectedChunks.length > 0,
    );
    const chunk = site?.protectedChunks[0];
    if (chunk === undefined) throw new Error("Historical death site missing");
    const x = chunk.x * 16 + 8;
    const blockZ = chunk.z * 16 + 8;
    // Only this disposable server receives the elevated test platform.
    await rcon.command(
      `fill ${coordinates(x - 3, 200, blockZ - 3)} ${coordinates(x + 3, 200, blockZ + 3)} stone`,
    );
    await rcon.command(
      `fill ${coordinates(x - 3, 201, blockZ - 3)} ${coordinates(x + 3, 204, blockZ + 3)} air`,
    );
    await rcon.command("gamerule keep_inventory false");
    await rcon.command(`clear ${bot.username}`);
    await rcon.command(`give ${bot.username} minecraft:diamond 7`);
    await rcon.command(`experience set ${bot.username} 20 levels`);
    await rcon.command(
      `tp ${bot.username} ${coordinates(x + 0.5, 201, blockZ + 0.5)}`,
    );
    await waitUntil(
      "historical death platform received",
      () =>
        bot.entity.position.distanceTo(new Vec3(x + 0.5, 201, blockZ + 0.5)) <
          0.3 &&
        bot.inventory
          .items()
          .some((item) => item.name === "diamond" && item.count === 7) &&
        bot.experience.level === 20,
    );
    const kept = waitForMessage(bot, /items and experience stay with you/u);
    let died = false;
    const onDeath = () => {
      died = true;
    };
    bot.on("death", onDeath);
    try {
      await rcon.command(`heritagefixture death ${bot.username}`);
      await kept;
      await waitUntil("native respawn", () => died && bot.health === 20);
      await waitUntil("preserved inventory after native respawn", () =>
        bot.inventory
          .items()
          .some((item) => item.name === "diamond" && item.count === 7),
      );
      expect(bot.experience.level).toBe(20);
      expect(
        await rcon.command(
          `execute if block ${coordinates(x, 201, blockZ)} air`,
        ),
      ).toContain("Test passed");
      expect(
        await rcon.command(
          `execute if entity @e[type=item,x=${x.toString()},y=201,z=${blockZ.toString()},distance=..8]`,
        ),
      ).toContain("Test failed");
    } finally {
      bot.off("death", onDeath);
    }
  });
});
