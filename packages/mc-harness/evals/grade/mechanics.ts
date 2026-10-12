import { z } from "zod";
import { CommandResponseSchema } from "#protocol/bridge.ts";
import type { GradeCheck, Grader } from "#evals/lib/types.ts";
import { sandboxFrom } from "#evals/grade/tower.ts";

export type SlotItem = { slot: number; id: string; count: number };

/** Parses `data get block x y z Items` feedback (`[{Slot: 0b, id: "…", count: 3}]`). */
export function parseItems(output: string): SlotItem[] | null {
  if (!output.includes("has the following block data")) {
    return null;
  }
  const items: SlotItem[] = [];
  for (const match of output.matchAll(
    /\{Slot: (\d+)b, id: "([^"]+)", count: (\d+)\}/gu,
  )) {
    items.push({
      slot: Number(match[1]),
      id: match[2] ?? "",
      count: Number(match[3]),
    });
  }
  return items;
}

const count = (items: readonly SlotItem[], id: string, slot?: number): number =>
  items
    .filter(
      (item) => item.id === id && (slot === undefined || item.slot === slot),
    )
    .reduce((sum, item) => sum + item.count, 0);

export type FurnaceInspection = {
  chest: SlotItem[] | null;
  hopper: SlotItem[] | null;
  furnace: SlotItem[] | null;
  topHopperFurnace: SlotItem[] | null;
};

/**
 * Ground truth for E4 at 600 ticks: three smelts finish (200 ticks each), so
 * five raw iron remain and three ingots exist between the furnace output, the
 * hopper and the chest (the third may still be in transit); a hopper on top
 * feeds the input slot. Pure: the caller inspects the world.
 */
export function gradeFurnace(
  claims: Record<string, unknown> | null,
  inspected: FurnaceInspection,
): GradeCheck[] {
  const chestClaim = claims?.["ingotsInChest"];
  const rawClaim = claims?.["rawIronRemaining"];
  const slotClaim = claims?.["topHopperFillsSlot"];
  const checks: GradeCheck[] = [
    {
      name: "claimed ingots in chest (2 or 3)",
      pass: chestClaim === 2 || chestClaim === 3,
      detail: String(chestClaim),
    },
    {
      name: "claimed raw iron remaining (5)",
      pass: rawClaim === 5,
      detail: String(rawClaim),
    },
    {
      name: "claimed top hopper fills the input slot",
      pass: slotClaim === "input",
      detail: String(slotClaim),
    },
  ];
  const { chest, hopper, furnace, topHopperFurnace } = inspected;
  if (chest === null || hopper === null || furnace === null) {
    checks.push({
      name: "world state inspectable at the reported positions",
      pass: false,
      detail: "chest, hopper or furnace position missing or not a container",
    });
  } else {
    const ingots =
      count(chest, "minecraft:iron_ingot") +
      count(hopper, "minecraft:iron_ingot") +
      count(furnace, "minecraft:iron_ingot", 2);
    const raw = count(furnace, "minecraft:raw_iron", 0);
    checks.push(
      {
        name: "world: 3 ingots between furnace output, hopper and chest",
        pass: ingots === 3,
        detail: `${String(ingots)} (chest ${String(count(chest, "minecraft:iron_ingot"))})`,
      },
      {
        name: "world: 5 raw iron left in the furnace input",
        pass: raw === 5,
        detail: String(raw),
      },
      {
        name: "world: claimed chest count matches the chest (±1 in transit)",
        pass:
          typeof chestClaim === "number" &&
          Math.abs(count(chest, "minecraft:iron_ingot") - chestClaim) <= 1,
        detail: `claimed ${String(chestClaim)}, chest holds ${String(count(chest, "minecraft:iron_ingot"))}`,
      },
    );
  }
  checks.push({
    name: "world: top-hopper furnace has an item in its input slot",
    pass: topHopperFurnace?.some((item) => item.slot === 0) === true,
    detail:
      topHopperFurnace === null
        ? "position missing or not a furnace"
        : JSON.stringify(topHopperFurnace),
  });
  return checks;
}

const PositionSchema = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
]);
const PositionsSchema = z.record(z.string(), z.unknown());

/** E4: check the agent's numbers and independently inspect the frozen setups. */
export const mechanicsGrader: Grader = async (ctx) => {
  const sandbox = sandboxFrom(ctx);
  const positions = PositionsSchema.safeParse(ctx.result?.["positions"]);
  const positionOf = (key: string): [number, number, number] | null => {
    if (!positions.success) {
      return null;
    }
    const parsed = PositionSchema.safeParse(positions.data[key]);
    return parsed.success ? parsed.data : null;
  };
  const notes: string[] = [];
  const inspect = async (key: string): Promise<SlotItem[] | null> => {
    const pos = positionOf(key);
    if (sandbox === null || pos === null) {
      return null;
    }
    const response = await ctx.daemon.request(
      CommandResponseSchema,
      "POST",
      `/targets/${sandbox}/command`,
      { command: `data get block ${pos.join(" ")} Items` },
    );
    const output = response.output.join("\n");
    notes.push(`${key} ${pos.join(",")}: ${output}`);
    return parseItems(output);
  };
  const inspected: FurnaceInspection = {
    chest: await inspect("chest"),
    hopper: await inspect("hopper"),
    furnace: await inspect("furnace"),
    topHopperFurnace: await inspect("topHopperFurnace"),
  };
  if (sandbox !== null) {
    const tick = await ctx.daemon.request(
      CommandResponseSchema,
      "POST",
      `/targets/${sandbox}/command`,
      {
        command: "tick query",
      },
    );
    notes.push(`tick query: ${tick.output.join(" ")}`);
  }
  return { checks: gradeFurnace(ctx.result, inspected), artifacts: [], notes };
};
