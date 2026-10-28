import { Vec3 } from "vec3";
import { expect } from "vitest";
import type { Bot } from "mineflayer";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

async function buildHub(rcon: RconClient): Promise<void> {
  await waitUntil(
    "previous world gate is closed",
    async () => {
      const result = await rcon.command(
        "execute if block 960 71 0 minecraft:nether_portal",
      );
      return !result.includes("Test passed");
    },
    15_000,
  );
  await rcon.command("forceload add 944 -16 976 0");
  await rcon.command("fill 955 69 0 975 69 5 minecraft:stone");
  expect(
    await rcon.command("execute if block 961 69 3 minecraft:stone"),
  ).toContain("Test passed");
  await rcon.command("fill 957 70 0 963 76 0 minecraft:air");
  await rcon.command("fill 959 70 1 961 70 3 minecraft:stone");
  await rcon.command("fill 969 70 0 971 70 2 minecraft:stone");
  for (const dimension of ["frontier", "skylands"]) {
    await rcon.command(
      `execute in minecraft:${dimension} run forceload add 960 0`,
    );
    await rcon.command(
      `execute in minecraft:${dimension} run fill 969 70 0 971 70 2 minecraft:stone`,
    );
    await rcon.command(
      `execute in minecraft:${dimension} run fill 969 71 0 971 73 2 minecraft:air`,
    );
  }
  for (const y of ["70", "76"])
    await rcon.command(`fill 959 ${y} 0 961 ${y} 0 minecraft:obsidian`);
  for (const y of ["71", "75"])
    for (const x of ["958", "962"])
      await rcon.command(`setblock ${x} ${y} 0 minecraft:obsidian`);
  for (const x of ["957", "963"])
    await rcon.command(`fill ${x} 72 0 ${x} 74 0 minecraft:obsidian`);
  await rcon.command(
    "setblock 957 72 1 minecraft:stone_button[face=wall,facing=south]",
  );
  await rcon.command("setblock 963 72 1 minecraft:oak_wall_sign[facing=south]");
  await rcon.command(
    'data merge block 963 72 1 {front_text:{messages:["World Gate","Choose a world","Worlds","Press button"]}}',
  );
}

async function enterHub(
  bot: Bot,
  rcon: RconClient,
  destination: string,
  mounted = false,
): Promise<void> {
  await rcon.command(
    `execute in minecraft:overworld run tp ${bot.username} 963.5 71 3.5`,
  );
  await waitUntil("world gate controls in reach", async () => {
    const result = await rcon.command(
      `execute in minecraft:overworld positioned 963.5 71 3.5 if entity @a[name=${bot.username},distance=..2]`,
    );
    return (
      result.includes("Test passed") &&
      Math.abs(bot.entity.position.x - 963.5) < 0.3
    );
  });
  const signPos = new Vec3(963, 72, 1);
  await waitUntil(
    "world gate sign loaded",
    () => bot.blockAt(signPos)?.name === "oak_wall_sign",
  );
  const sign = bot.blockAt(signPos);
  if (sign === null) throw new Error("World gate sign is missing");
  await waitUntil(
    "world gate is closed for selection",
    async () => {
      const result = await rcon.command(
        "execute if block 960 71 0 minecraft:air",
      );
      return result.includes("Test passed");
    },
    15_000,
  );
  let selected = false;
  for (let attempt = 0; !selected && attempt < 4; attempt++) {
    const next = waitForMessage(bot, /Destination: ([^.]+)/u);
    await bot.activateBlock(sign);
    const match = await next;
    selected = match[1] === destination;
  }
  if (!selected)
    throw new Error(`Could not select world gate destination ${destination}`);
  await rcon.command(`tp ${bot.username} 957.5 71 2.5`);
  await waitUntil(
    "world gate button in reach",
    () =>
      Math.abs(bot.entity.position.x - 957.5) < 0.3 &&
      bot.entity.position.z > 2,
  );
  const button = bot.blockAt(new Vec3(957, 72, 1));
  if (button === null) throw new Error("World gate button is missing");
  await bot.activateBlock(button);
  await waitUntil(
    "world gate opens",
    () => bot.blockAt(new Vec3(960, 71, 0))?.name === "nether_portal",
  );
  await rcon.command(`tp ${bot.username} 960.5 71 2.5`);
  await waitUntil(
    "world gate approach",
    () =>
      Math.abs(bot.entity.position.x - 960.5) < 0.3 &&
      bot.entity.position.z > 2,
  );
  if (mounted) {
    await rcon.command(
      'summon minecraft:oak_boat 960.5 71 2.5 {Tags:["world_gate_boat"]}',
    );
    await rcon.command(
      `ride ${bot.username} mount @e[tag=world_gate_boat,limit=1]`,
    );
    await waitUntil("rider mounts world-gate boat", async () => {
      const result = await rcon.command(
        `execute as ${bot.username} on vehicle if entity @s[tag=world_gate_boat]`,
      );
      return result.includes("Test passed");
    });
    let boatZ = 2.5;
    if (destination === "Creative") {
      let denied = false;
      const capture = (message: string) => {
        if (message.includes("Dismount before entering Creative"))
          denied = true;
      };
      bot.on("messagestr", capture);
      try {
        await waitUntil("Creative rejects a mounted player", () => {
          if (denied) return true;
          boatZ = Math.max(0.5, boatZ - 0.2);
          bot._client.write("vehicle_move", {
            x: 960.5,
            y: 71,
            z: boatZ,
            yaw: 180,
            pitch: 0,
            onGround: true,
          });
          return false;
        });
      } finally {
        bot.off("messagestr", capture);
      }
      const stillRiding = await rcon.command(
        `execute in minecraft:overworld as @a[name=${bot.username}] on vehicle if entity @s[tag=world_gate_boat]`,
      );
      expect(stillRiding).toContain("Test passed");
      return;
    }
    await waitUntil(
      "mounted arrival in 2026",
      async () => {
        const result = await rcon.command(
          `execute in minecraft:frontier as @a[name=${bot.username}] on vehicle if entity @s[tag=world_gate_boat]`,
        );
        if (result.includes("Test passed")) return true;
        boatZ = Math.max(0.5, boatZ - 0.2);
        bot._client.write("vehicle_move", {
          x: 960.5,
          y: 71,
          z: boatZ,
          yaw: 180,
          pitch: 0,
          onGround: true,
        });
        return false;
      },
      20_000,
    );
    return;
  }
  await bot.lookAt(new Vec3(960.5, 71, 0.5));
  bot.setControlState("forward", true);
  try {
    await waitUntil("enter world gate", () => bot.entity.position.z < 1);
  } finally {
    bot.setControlState("forward", false);
  }
}

test("world gate carries a boat and rider to the 2026 world", async ({
  bot,
  rcon,
}) => {
  const messages: string[] = [];
  bot.on("messagestr", (message) => {
    messages.push(message);
  });
  await buildHub(rcon);
  try {
    await enterHub(bot, rcon, "2026", true);
  } catch (error) {
    throw new Error(`Mounted world travel failed: ${messages.join(" | ")}`, {
      cause: error,
    });
  }
});

test("world gate requires riders to dismount before entering Creative", async ({
  bot,
  rcon,
}) => {
  await buildHub(rcon);
  await enterHub(bot, rcon, "Creative", true);
});

test("server world gate reaches all four worlds and preserves survival inventory through Creative", async ({
  bot,
  rcon,
}) => {
  const messages: string[] = [];
  bot.on("messagestr", (message) => {
    messages.push(message);
  });
  await buildHub(rcon);
  await rcon.command(`clear ${bot.username} minecraft:diamond`);
  await rcon.command(`give ${bot.username} minecraft:diamond 1`);
  await waitUntil("survival diamond", () =>
    bot.inventory
      .items()
      .some((item) => item.name === "diamond" && item.count === 1),
  );
  for (const [label, dimension] of [
    ["2026", "frontier"],
    ["2015", "overworld"],
    ["Skylands", "skylands"],
  ] as const) {
    try {
      await enterHub(bot, rcon, label);
    } catch (error) {
      const sign = await rcon.command("data get block 963 72 1 front_text");
      throw new Error(
        `Selecting ${label} failed: ${messages.join(" | ")}; ${sign}`,
        { cause: error },
      );
    }
    await waitUntil(
      `${label} arrival`,
      async () => {
        const result = await rcon.command(
          `execute in minecraft:${dimension} positioned 970.5 71 1.5 if entity @a[name=${bot.username},distance=..3]`,
        );
        return result.includes("Test passed");
      },
      15_000,
    );
    await waitUntil(
      "world gate closes",
      async () => {
        const response = await rcon.command(
          "execute if block 960 71 0 minecraft:air",
        );
        return response.includes("Test passed");
      },
      15_000,
    );
  }
  await enterHub(bot, rcon, "Creative");
  await waitUntil(
    "creative arrival",
    async () => {
      const result = await rcon.command(
        `execute in minecraft:creative positioned -0.5 65 -0.5 if entity @a[name=${bot.username},distance=..3]`,
      );
      return result.includes("Test passed");
    },
    15_000,
  );
  expect(bot.inventory.items().some((item) => item.name === "diamond")).toBe(
    false,
  );
  bot.chat("/creative leave");
  await waitUntil(
    "survival inventory restored",
    () =>
      bot.entity.position.x > 950 &&
      bot.inventory
        .items()
        .some((item) => item.name === "diamond" && item.count === 1),
    15_000,
  );
});

test("a server gate on preserved land does not rewrite its sign or open its portal", async ({
  bot,
  rcon,
}) => {
  await rcon.command("forceload add 96 96");
  await rcon.command("fill 96 69 98 105 69 105 minecraft:stone");
  expect(
    await rcon.command("execute if block 101 69 103 minecraft:stone"),
  ).toContain("Test passed");
  await rcon.command("fill 97 70 100 103 76 100 minecraft:air");
  for (const y of ["70", "76"])
    await rcon.command(`fill 99 ${y} 100 101 ${y} 100 minecraft:obsidian`);
  for (const y of ["71", "75"])
    for (const x of ["98", "102"])
      await rcon.command(`setblock ${x} ${y} 100 minecraft:obsidian`);
  for (const x of ["97", "103"])
    await rcon.command(`fill ${x} 72 100 ${x} 74 100 minecraft:obsidian`);
  await rcon.command(
    "setblock 97 72 101 minecraft:stone_button[face=wall,facing=south]",
  );
  await rcon.command(
    "setblock 103 72 101 minecraft:oak_wall_sign[facing=south]",
  );
  await rcon.command(
    'data merge block 103 72 101 {front_text:{messages:["World Gate","Choose a world","Worlds","Press button"]}}',
  );
  await rcon.command(`tp ${bot.username} 103.5 70 103.5`);
  await waitUntil(
    "protected gate sign loaded",
    () => bot.blockAt(new Vec3(103, 72, 101))?.name === "oak_wall_sign",
  );
  const sign = bot.blockAt(new Vec3(103, 72, 101));
  if (sign === null) throw new Error("Protected gate sign is missing");
  const selected = waitForMessage(bot, /Destination: 2015/u);
  await bot.activateBlock(sign);
  await selected;
  expect(await rcon.command("data get block 103 72 101 front_text")).toContain(
    "Choose a world",
  );
  await rcon.command(`tp ${bot.username} 97.5 70 102.5`);
  const button = bot.blockAt(new Vec3(97, 72, 101));
  if (button === null) throw new Error("Protected gate button is missing");
  const refused = waitForMessage(bot, /world gate is in preserved land/iu);
  await bot.activateBlock(button);
  await refused;
  expect(
    await rcon.command("execute if block 100 71 100 minecraft:air"),
  ).toContain("Test passed");
});

test("an explicitly permitted preserved gate transports players and closes without rewriting its sign", async ({
  bot,
  rcon,
}) => {
  await rcon.command("forceload add 112 96 128 96");
  await rcon.command("forceload add 960 0");
  await rcon.command("fill 969 70 0 971 70 2 minecraft:stone");
  await rcon.command("fill 969 71 0 971 73 2 minecraft:air");
  await rcon.command("fill 115 69 98 125 69 105 minecraft:stone");
  await rcon.command("fill 119 70 101 121 70 103 minecraft:stone");
  await rcon.command("fill 117 70 100 123 76 100 minecraft:air");
  for (const y of ["70", "76"])
    await rcon.command(`fill 119 ${y} 100 121 ${y} 100 minecraft:obsidian`);
  for (const y of ["71", "75"])
    for (const x of ["118", "122"])
      await rcon.command(`setblock ${x} ${y} 100 minecraft:obsidian`);
  for (const x of ["117", "123"])
    await rcon.command(`fill ${x} 72 100 ${x} 74 100 minecraft:obsidian`);
  await rcon.command(
    "setblock 117 72 101 minecraft:stone_button[face=wall,facing=south]",
  );
  await rcon.command(
    "setblock 123 72 101 minecraft:birch_wall_sign[facing=south]",
  );
  await rcon.command(
    'data merge block 123 72 101 {front_text:{messages:["World Gate","Choose a world","Worlds","Press button"]}}',
  );
  await rcon.command(`tp ${bot.username} 123.5 70 103.5`);
  await waitUntil(
    "visitor reaches permitted gate",
    () => Math.abs(bot.entity.position.x - 123.5) < 0.3,
  );
  await waitUntil(
    "permitted gate sign loaded",
    () => bot.blockAt(new Vec3(123, 72, 101))?.name === "birch_wall_sign",
  );
  const sign = bot.blockAt(new Vec3(123, 72, 101));
  if (sign === null) throw new Error("Permitted gate sign is missing");
  const selected = waitForMessage(bot, /Destination: 2015/u);
  await bot.activateBlock(sign);
  await selected;
  expect(await rcon.command("data get block 123 72 101 front_text")).toContain(
    "Choose a world",
  );
  await rcon.command(`tp ${bot.username} 117.5 70 102.5`);
  await waitUntil(
    "visitor reaches permitted gate button",
    () => Math.abs(bot.entity.position.x - 117.5) < 0.3,
  );
  const button = bot.blockAt(new Vec3(117, 72, 101));
  if (button === null) throw new Error("Permitted gate button is missing");
  await bot.activateBlock(button);
  await waitUntil(
    "permitted portal opens",
    () => bot.blockAt(new Vec3(120, 71, 100))?.name === "nether_portal",
  );
  expect(
    await rcon.command("execute if block 119 70 100 minecraft:obsidian"),
  ).toContain("Test passed");
  expect(
    await rcon.command("execute if block 116 69 100 minecraft:stone"),
  ).toContain("Test passed");
  await rcon.command(`tp ${bot.username} 120.5 71 102.5`);
  await waitUntil(
    "visitor reaches protected portal",
    () =>
      Math.abs(bot.entity.position.x - 120.5) < 0.3 &&
      bot.entity.position.z > 102,
  );
  await bot.lookAt(new Vec3(120.5, 71, 100.5));
  bot.setControlState("forward", true);
  try {
    await waitUntil(
      "visitor enters protected portal",
      () => bot.entity.position.z < 101,
    );
  } finally {
    bot.setControlState("forward", false);
  }
  await waitUntil(
    "visitor arrives at 2015 destination",
    async () => {
      const response = await rcon.command(
        `execute in minecraft:overworld positioned 970.5 71 1.5 if entity @a[name=${bot.username},distance=..3]`,
      );
      return response.includes("Test passed");
    },
    15_000,
  );
  await waitUntil(
    "permitted portal closes",
    async () => {
      const response = await rcon.command(
        "execute if block 120 71 100 minecraft:air",
      );
      return response.includes("Test passed");
    },
    15_000,
  );
  expect(await rcon.command("data get block 123 72 101 front_text")).toContain(
    "Choose a world",
  );
});
