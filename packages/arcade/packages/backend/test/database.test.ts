import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { createPrisma } from "@discord-plays-mario-kart/backend/database/index.ts";
import { initializeDatabase } from "#src/database.ts";

it("initializes a fresh database and preserves player and race history on restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "arcade-database-"));
  const file = path.join(root, "arcade.db");
  const db = createPrisma(`file:${file}`);
  try {
    await initializeDatabase(file);
    await db.player.create({
      data: { discordId: "123", username: "alice", name: "Alice" },
    });
    await db.race.create({
      data: { guildId: "456", courseId: 0, gameMode: "versus", humanCount: 1 },
    });
    await initializeDatabase(file);
    expect(await db.player.count()).toBe(1);
    const recorded = await db.race.findFirst();
    expect(recorded?.gameId).toBe("mk64");
    expect(await db.smashMatch.count()).toBe(0);
  } finally {
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
