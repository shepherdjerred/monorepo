import path from "node:path";
import { gridFromRegionRead } from "@shepherdjerred/mc-build/core/grid.ts";
import { RegionReadResponseSchema } from "#protocol/bridge.ts";
import type { GradeContext, Grader } from "#evals/lib/types.ts";
import { gradeTower, type TowerSpec, towerBox } from "#evals/grade/geometry.ts";

export const E1_SPEC: TowerSpec = {
  center: { x: 0, z: 0 },
  baseY: -60,
  height: 14,
  wall: "minecraft:stone_bricks",
  window: "minecraft:glass",
  ground: "minecraft:grass_block",
};

export const E6_SPEC: TowerSpec = {
  ...E1_SPEC,
  center: { x: -20, z: -20 },
  wall: "minecraft:deepslate_bricks",
};

export function sandboxFrom(ctx: GradeContext, key = "sandbox"): string | null {
  const value = ctx.result?.[key];
  return typeof value === "string" && /^sbx-[0-9a-f]{6}$/u.test(value)
    ? value
    : null;
}

/** E1/E6: read the tower box from the agent's sandbox and check the geometry. */
export function towerGrader(spec: TowerSpec): Grader {
  return async (ctx) => {
    const sandbox = sandboxFrom(ctx);
    if (sandbox === null) {
      return {
        checks: [
          {
            name: "result.json names the sandbox",
            pass: false,
            detail: JSON.stringify(ctx.result),
          },
        ],
        artifacts: [],
        notes: [],
      };
    }
    const box = towerBox(spec);
    const region = await ctx.daemon.request(
      RegionReadResponseSchema,
      "POST",
      `/targets/${sandbox}/region-read`,
      { world: "world", ...box },
    );
    const file = path.join(ctx.taskDir, "graded-region.json");
    await Bun.write(file, JSON.stringify(region));
    return {
      checks: gradeTower(gridFromRegionRead(region), spec),
      artifacts: [file],
      notes: [],
    };
  };
}
