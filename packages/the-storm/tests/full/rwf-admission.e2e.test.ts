import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { disconnectBot } from "#e2e/harness/bot.ts";
import { count } from "#e2e/harness/rwf-humans.ts";
import {
  eventually,
  status,
  transcript,
  waitForLobby,
} from "#e2e/harness/rwf-match.ts";
import { packageRoot } from "#e2e/harness/paths.ts";

test(
  "a queued watcher joins the next lobby after uncached preferences load",
  { timeout: 120_000 },
  async ({ bot: watcher, secondBot: host, rcon }) => {
    await waitForLobby(rcon);
    const hostChat = transcript(host);
    const watcherChat = transcript(watcher);
    const receipt = {
      host: host.username,
      watcher: watcher.username,
      joinCommands: 0,
      firstMatch: "",
      nextMatch: "",
      restored: false,
    };
    const output = path.join(
      packageRoot,
      ".cache/rwf-admission",
      watcher.username,
    );
    await mkdir(output, { recursive: true });
    try {
      host.chat("/rwf join");
      await hostChat.until(/The game has begun!/u, 30_000);
      const live = await status(rcon);
      receipt.firstMatch = live.matchId;
      expect(live.phase).toBe("Live");
      expect(live.humans).toBe(1);

      await rcon.command(`give ${watcher.username} minecraft:diamond 3`);
      await eventually(
        "the watcher's original inventory",
        async () => count(watcher, "diamond") === 3,
      );
      const home = {
        inventory: structuredClone(watcher.inventory.slots),
        mode: watcher.game.gameMode,
        dimension: watcher.game.dimension,
        position: watcher.entity.position.clone(),
        yaw: watcher.entity.yaw,
        pitch: watcher.entity.pitch,
        health: watcher.health,
        food: watcher.food,
      };

      // The fixture actor is fresh and has never requested admission or streaks.
      watcher.chat("/rwf join");
      receipt.joinCommands++;
      await watcherChat.until(/A match is under way: you join the next one\./u);
      await eventually(
        "the queued watcher in spectator mode",
        async () => watcher.game.gameMode === "spectator",
      );
      expect(await rcon.command("rwf admin status")).toContain("Watchers: 1");

      // The ordinary no-human abort opens the next ballot, which attempts admission.
      await disconnectBot(host);
      await watcherChat.until(
        /Loading your killstreak preferences; joining when ready\./u,
        30_000,
      );
      await eventually(
        "the queued watcher admitted without another join command",
        async () => {
          const next = await status(rcon);
          receipt.nextMatch = next.matchId;
          return next.matchId !== live.matchId && next.humans === 1;
        },
        30_000,
      );
      expect(receipt.nextMatch).not.toBe(live.matchId);
      expect(receipt.joinCommands).toBe(1);
      expect(await rcon.command("rwf who")).toContain(watcher.username);
      expect(await rcon.command("rwf admin status")).toContain("Watchers: 0");
      await eventually(
        "the admitted watcher out of spectator mode",
        async () => watcher.game.gameMode !== "spectator",
      );

      watcher.chat("/rwf leave");
      await eventually(
        "the original watcher snapshot restored after admission",
        async () =>
          watcher.game.gameMode === home.mode &&
          watcher.game.dimension === home.dimension &&
          watcher.entity.position.distanceTo(home.position) < 1 &&
          count(watcher, "diamond") === 3,
        20_000,
      );
      expect(watcher.inventory.slots).toEqual(home.inventory);
      expect(watcher.health).toBe(home.health);
      expect(watcher.food).toBe(home.food);
      expect(watcher.entity.yaw).toBeCloseTo(home.yaw, 4);
      expect(watcher.entity.pitch).toBeCloseTo(home.pitch, 4);
      receipt.restored = true;
    } finally {
      await Bun.write(
        path.join(output, "receipt.json"),
        JSON.stringify(
          { ...receipt, receivedMessages: watcherChat.lines },
          null,
          2,
        ),
      );
      watcher.chat("/rwf leave");
      await disconnectBot(host);
      await waitForLobby(rcon);
    }
  },
);
