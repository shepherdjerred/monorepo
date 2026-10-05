import { expect } from "vitest";
import { z } from "zod";
import { Vec3 } from "vec3";
import { test } from "#e2e/arena-fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import {
  startProtectedSettlementRound,
  startSettlementRound,
} from "#e2e/harness/settlement.ts";

const ParticleSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  amount: z.number().int(),
  particle: z.object({ type: z.string() }),
});

test("nearby generator and cache particles arrive repeatedly above their blocks", async ({
  bot,
  rcon,
}) => {
  await startProtectedSettlementRound(bot, rcon, 8);
  await rcon.command(
    `attribute ${bot.username} minecraft:knockback_resistance base set 1`,
  );
  const particles: z.infer<typeof ParticleSchema>[] = [];
  const heard = (packet: unknown) => {
    particles.push(ParticleSchema.parse(packet));
  };
  bot._client.on("world_particles", heard);
  try {
    for (const [x, baseY, positionZ, height] of [
      [58.5, 89, 2.5, 91],
      [-1.5, 73, 62.5, 74],
    ] as const) {
      await rcon.command(
        `tp ${bot.username} ${x.toString()} ${baseY.toString()} ${(positionZ + 4).toString()}`,
      );
      await waitUntil(
        "particle viewpoint",
        () => Math.abs(bot.entity.position.x - x) < 0.6,
      );
      particles.length = 0;
      await Bun.sleep(1500);
      const markers = particles.filter(
        (p) =>
          Math.abs(p.x - x) < 1 &&
          Math.abs(p.z - positionZ) < 1 &&
          p.y > height,
      );
      expect(markers.length).toBeGreaterThanOrEqual(3);
      expect(markers.reduce((sum, p) => sum + p.amount, 0)).toBeLessThanOrEqual(
        32,
      );
    }
  } finally {
    bot._client.off("world_particles", heard);
    await rcon.command("arena stop settlement");
    await rcon.command("difficulty peaceful");
  }
}, 60_000);

test("boss danger marks remain above the terrain throughout a native channel", async ({
  bot,
  rcon,
}) => {
  await startSettlementRound(bot, rcon, 5);
  const boss =
    '@e[type=minecraft:breeze,nbt={BukkitValues:{"thestorm:arena_entity":"settlement"}},limit=1]';
  const particles: z.infer<typeof ParticleSchema>[] = [];
  const heard = (packet: unknown) => {
    particles.push(ParticleSchema.parse(packet));
  };
  bot._client.on("world_particles", heard);
  try {
    await rcon.command(
      `effect give ${bot.username} minecraft:resistance infinite 255 true`,
    );
    await rcon.command(`storm-fixture-survival terrain ${bot.username} none`);
    await rcon.command(`tp ${bot.username} 23.5 105 -40.5`);
    await rcon.command(`tp ${boss} 19.5 105 -40.5`);
    await rcon.command(`data merge entity ${boss} {NoAI:1b}`);
    await waitForMessage(bot, /Breeze Sovereign casts.*marked ground/u, 15_000);
    particles.length = 0;
    await Bun.sleep(1000);
    const ground = particles.filter(
      (p) =>
        ["flame", "soul_fire_flame"].includes(p.particle.type) &&
        p.y > 104 &&
        p.y < 106,
    );
    expect(ground.length).toBeGreaterThan(6);
    for (const particle of ground) {
      const at = new Vec3(particle.x, Math.floor(particle.y), particle.z);
      expect(bot.blockAt(at)?.boundingBox).toBe("empty");
      expect(bot.blockAt(at.offset(0, -1, 0))?.boundingBox).toBe("block");
      expect(particle.y - Math.floor(particle.y)).toBeCloseTo(0.12);
    }
  } finally {
    bot._client.off("world_particles", heard);
    await rcon.command("arena stop settlement");
    await rcon.command("difficulty peaceful");
  }
}, 60_000);
