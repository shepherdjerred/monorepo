import { randomBytes } from "node:crypto";
import type { Bot } from "mineflayer";
import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";
import {
  collectMessages,
  connectBot,
  disconnectBot,
  waitUntil,
} from "./harness/bot.ts";

function username(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

describe("onboarding", () => {
  test("new players receive iron tools and sixteen cooked porkchops", async ({
    bot,
  }) => {
    await waitUntil("starter inventory delivered", () =>
      bot.inventory.items().some((item) => item.name === "cooked_porkchop"),
    );
    for (const name of [
      "iron_sword",
      "iron_pickaxe",
      "iron_axe",
      "iron_shovel",
      "iron_hoe",
      "white_bed",
      "written_book",
    ]) {
      expect(
        bot.inventory.items().some((item) => item.name === name),
        name,
      ).toBe(true);
    }
    expect(
      bot.inventory.items().find((item) => item.name === "cooked_porkchop")
        ?.count,
    ).toBe(16);
    expect(bot.inventory.items().some((item) => item.name === "bread")).toBe(
      false,
    );
  });

  test("a non-operator can reopen the guide without receiving another kit", async ({
    bot,
  }) => {
    await waitUntil("starter book delivered", () =>
      bot.inventory.items().some((item) => item.name === "written_book"),
    );
    const before = bot.inventory.items().map((item) => [item.name, item.count]);
    let opened = false;
    bot._client.once("open_book", () => {
      opened = true;
    });
    bot.chat("/guide");
    await waitUntil("guide book opened", () => opened);
    expect(
      bot.inventory.items().map((item) => [item.name, item.count]),
    ).toEqual(before);
  });

  test("maintenance defers for humans, blocks empty-server admission and reopens for its owner", async ({
    server,
    rcon,
  }) => {
    const owner = "onboarding-check";
    const player = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: username("m"),
    });
    try {
      expect(
        JSON.parse(await rcon.command(`storm-maintenance begin ${owner}`)),
      ).toMatchObject({ state: "occupied", players: 1 });
    } finally {
      await disconnectBot(player);
    }
    try {
      // Client socket closure precedes Paper's removal on its next tick.
      await waitUntil("server observed the departure", async () => {
        const online = await rcon.command("list");
        return online.includes("There are 0 of");
      });
      expect(
        JSON.parse(await rcon.command(`storm-maintenance begin ${owner}`)),
      ).toMatchObject({ state: "ready", players: 0 });
      expect(
        JSON.parse(await rcon.command("storm-maintenance end wrong-owner")),
      ).toMatchObject({ state: "conflict" });
      await expect(
        connectBot({
          host: server.host,
          port: server.gamePort,
          username: username("g"),
        }),
      ).rejects.toThrow(/undergoing maintenance/);
    } finally {
      expect(
        JSON.parse(await rcon.command(`storm-maintenance end ${owner}`)),
      ).toMatchObject({ state: "open" });
    }
    const admitted = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: username("o"),
    });
    await disconnectBot(admitted);
  });

  test("first-joiners get the biome dialog and no welcome chat", async ({
    server,
  }) => {
    const arrival: string[] = [];
    const dialogs: unknown[] = [];
    const newcomer = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: username("n"),
      onMessage: (line) => {
        arrival.push(line);
      },
      prepare: (bot) => {
        bot._client.on("packet", (_data: unknown, meta: { name: string }) => {
          if (meta.name === "show_dialog") dialogs.push(meta.name);
        });
      },
    });
    try {
      await waitUntil("biome dialog", () => dialogs.length > 0);
      const seen = [...arrival, ...(await collectMessages(newcomer, 2000))];
      const shown = (pattern: RegExp) =>
        seen.some((line) => pattern.test(line));
      expect(shown(/Welcome to The Storm/)).toBe(false);
      expect(shown(/Use your compass to choose a biome/)).toBe(false);
      expect(shown(/You start with/)).toBe(false);
      expect(shown(/\/guide/)).toBe(false);
      expect(shown(/\/kit\b|You received the .* kit/)).toBe(false);
    } finally {
      await disconnectBot(newcomer);
    }
  });

  test("returning players are not greeted again", async ({ server }) => {
    const name = username("r");
    const firstArrival: string[] = [];
    const dialogs: unknown[] = [];
    const first = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: name,
      onMessage: (line) => {
        firstArrival.push(line);
      },
      prepare: (bot) => {
        bot._client.on("packet", (_data: unknown, meta: { name: string }) => {
          if (meta.name === "show_dialog") dialogs.push(meta.name);
        });
      },
    });
    await waitUntil("biome dialog", () => dialogs.length > 0);
    expect(
      firstArrival.some((line) => line.includes("Welcome to The Storm")),
    ).toBe(false);
    await disconnectBot(first);

    const returningArrival: string[] = [];
    const again = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: name,
      onMessage: (line) => {
        returningArrival.push(line);
      },
    });
    try {
      // Past the greeting delay: silence proves the server remembered.
      const seen = [
        ...returningArrival,
        ...(await collectMessages(again, 6000)),
      ];
      expect(seen.some((line) => line.includes("Welcome to The Storm"))).toBe(
        false,
      );
      expect(
        seen.some((line) =>
          line.includes("Use your compass to choose a biome"),
        ),
      ).toBe(false);
    } finally {
      await disconnectBot(again);
    }
  });
});

describe("player reset", () => {
  test("reset kicks a player and replays the complete first-join experience", async ({
    server,
    secondBot,
    rcon,
  }) => {
    const name = username("reset");
    let dialogs = 0;
    const prepare = (bot: Bot) => {
      bot._client.on("packet", (_data: unknown, meta: { name: string }) => {
        if (meta.name === "show_dialog") dialogs += 1;
      });
    };
    const connect = () =>
      connectBot({
        host: server.host,
        port: server.gamePort,
        username: name,
        prepare,
      });

    const first = await connect();
    await waitUntil("first starter kit", () =>
      first.inventory.items().some((item) => item.name === "cooked_porkchop"),
    );
    await waitUntil("first-join biome dialog", () => dialogs === 1);
    expect(dialogs).toBe(1);
    await rcon.command(
      `item replace entity ${name} hotbar.0 with minecraft:diamond 3`,
    );
    await waitUntil("old inventory delivered", () =>
      first.inventory.items().some((item) => item.name === "diamond"),
    );
    first.chat("/sethome old");
    await Bun.sleep(500);
    await disconnectBot(first);

    const returning = await connect();
    expect(dialogs).toBe(1);
    expect(
      returning.inventory.items().some((item) => item.name === "diamond"),
    ).toBe(true);

    secondBot.chat(`/reset ${name}`);
    const deniedMessages = await collectMessages(secondBot, 500);
    expect(deniedMessages.some((line) => line.includes("Repeat /reset"))).toBe(
      false,
    );
    expect(
      returning.inventory.items().some((item) => item.name === "diamond"),
    ).toBe(true);
    await rcon.command(
      `lp user ${secondBot.username} permission set thestorm.reset true`,
    );
    await rcon.command(`reset ${name}`);
    const kicked = new Promise<void>((resolve) =>
      returning.once("end", (_reason) => resolve()),
    );
    await rcon.command(`reset ${name}`);
    await kicked;
    await waitUntil("reset completed", async () => {
      const logs = await serverLogs(server);
      return logs.includes("Permissions reset complete for ");
    });

    const fresh = await connect();
    await waitUntil("replacement starter kit", () =>
      fresh.inventory.items().some((item) => item.name === "cooked_porkchop"),
    );
    expect(dialogs).toBe(2);
    expect(
      fresh.inventory.items().some((item) => item.name === "diamond"),
    ).toBe(false);
    await disconnectBot(fresh);
  });
});
