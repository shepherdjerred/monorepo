import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { waitUntil } from "./harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

async function untilStatus(
  rcon: RconClient,
  predicate: (status: string) => boolean,
  timeout = 15_000,
) {
  const deadline = Date.now() + timeout;
  let status: string;
  do {
    status = await rcon.command("companiontest status");
    if (predicate(status)) return status;
    await Bun.sleep(250);
  } while (Date.now() < deadline);
  throw new Error(`Companion status never matched: ${status}`);
}

function identities(status: string) {
  return [...status.matchAll(/(rowan|juniper|flint) uuid=([a-f0-9-]+)/gu)]
    .map((match) => {
      if (match[1] === undefined || match[2] === undefined)
        throw new Error("Incomplete companion identity");
      return `${match[1]}:${match[2]}`;
    })
    .toSorted();
}

describe("Citizens survival companions on Paper", () => {
  test("native crafting and placement consume items and honor cancellation and claims", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`companiontest visit ${bot.username}`);
    const result = await rcon.command("companiontest native");
    expect(result).toContain(
      "native cancelled=false retained=2 crafted=true logs=1 planks=4 deniedMining=false mined=true placed=true remaining=3",
    );
    expect(result).toContain("food=15 bread=1");
  });

  test("three player bodies mine native resources and conserve inventories across suspension", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`companiontest visit ${bot.username}`);
    const initial = await untilStatus(
      rcon,
      (status) => (status.match(/uuid=/gu)?.length ?? 0) === 3,
    );
    expect(initial).toContain("BREAD:8");
    await waitUntil(
      "three visible companion player bodies",
      () =>
        Object.values(bot.entities).filter(
          (entity) =>
            entity.type === "player" && entity.username?.includes("[NPC]"),
        ).length === 3,
    );
    const mined = await untilStatus(
      rcon,
      (status) => /OAK_LOG:\d+/u.test(status),
      90_000,
    );
    const originalIdentities = identities(mined);
    expect(originalIdentities).toHaveLength(3);
    await rcon.command("companiontest off");
    await untilStatus(rcon, (status) => !status.includes("uuid="));
    await rcon.command("companiontest on");
    const restored = await untilStatus(
      rcon,
      (status) => (status.match(/uuid=/gu)?.length ?? 0) === 3,
    );
    expect(identities(restored)).toEqual(originalIdentities);
    expect(restored).toMatch(/OAK_LOG:\d+/u);
  }, 120_000);

  test("native death preserves identity and does not replace the starter inventory", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`companiontest visit ${bot.username}`);
    const before = await untilStatus(rcon, (status) =>
      status.includes("rowan uuid="),
    );
    const identity = /rowan uuid=([a-f0-9-]+)/u.exec(before)?.[1];
    if (identity === undefined)
      throw new Error("Missing Rowan identity before death");
    await rcon.command("companiontest kill rowan");
    const respawned = await untilStatus(rcon, (status) => {
      const rowan = status
        .split("\n")
        .find((line) => line.includes("rowan uuid="));
      return rowan !== undefined && !rowan.includes("BREAD:");
    });
    expect(respawned).toContain(`rowan uuid=${identity}`);
    const rowan = respawned
      .split("\n")
      .find((line) => line.includes("rowan uuid="));
    expect(rowan).not.toContain("WOODEN_PICKAXE:");
  });
});
