import { buildGrader } from "#evals/grade/build.ts";
import type { DeliveredSpec } from "#evals/grade/delivered.ts";
import { mechanicsGrader } from "#evals/grade/mechanics.ts";
import { playtestGrader } from "#evals/grade/playtest.ts";
import { E1_SPEC, E6_SPEC, towerGrader } from "#evals/grade/tower.ts";
import type { Grader } from "#evals/lib/types.ts";

export type TaskDef = {
  id: string;
  title: string;
  /** File under evals/tasks/. */
  file: string;
  timeoutMinutes: number;
  /**
   * `guided` names the skills and steps; `natural` is a plain user request,
   * so the agent must discover the repository guidance on its own.
   */
  preamble: "guided" | "natural";
  grade: Grader;
};

/**
 * A single building: must be a building, not a shed, and must not be mostly
 * one pasted piece. One lint warning is allowed (the library demands none;
 * the weak anchors carry at most one), so a flat facade on two sides, or a
 * flat facade and a dark interior, fails.
 */
const house: DeliveredSpec = {
  minHeight: 8,
  minBlocks: 300,
  features: ["door", "window", "roofStairs", "light"],
  maxLintWarnings: 1,
  maxRepeatRatio: 0.3,
};

/**
 * A map: scale is the point, with terrain relief, paths, trees and lights.
 * The facade and monotone rules measure the whole site box, so a map may
 * trip one of them on its terrain edge; two warnings are allowed, and more
 * (flat edges all round, or an unlit interior on top) fails.
 */
function map(
  size: number,
  extra: DeliveredSpec["features"] = [],
): DeliveredSpec {
  const side = Math.round(size * 0.75);
  return {
    minFootprint: { w: side, d: side },
    minHeight: 15,
    minBlocks: size * size * 2,
    features: ["door", "roofStairs", "light", "path", "tree", ...extra],
    maxLintWarnings: 2,
    maxRepeatRatio: 0.25,
  };
}

export const TASKS: readonly TaskDef[] = [
  {
    id: "e1",
    title: "precise WorldEdit tower",
    file: "e1-tower.md",
    timeoutMinutes: 30,
    preamble: "guided",
    grade: towerGrader(E1_SPEC),
  },
  {
    id: "e2",
    title: "cottage through the build pipeline",
    file: "e2-cottage.md",
    timeoutMinutes: 60,
    preamble: "guided",
    grade: buildGrader({
      reference: "cottage",
      rubric: "micro",
      expect: { ...house, minHeight: 6, minBlocks: 150 },
    }),
  },
  {
    id: "e3",
    title: "write and run a playtest",
    file: "e3-playtest.md",
    timeoutMinutes: 30,
    preamble: "guided",
    grade: playtestGrader,
  },
  {
    id: "e4",
    title: "validate furnace/hopper mechanics",
    file: "e4-validate.md",
    timeoutMinutes: 30,
    preamble: "guided",
    grade: mechanicsGrader,
  },
  {
    id: "e5",
    title: "two-story hillside house",
    file: "e5-hillside-house.md",
    timeoutMinutes: 75,
    preamble: "guided",
    grade: buildGrader({
      reference: "nordic-two-story",
      rubric: "micro",
      expect: { ...house, minHeight: 10 },
    }),
  },
  {
    id: "e6",
    title: "negative-quadrant WorldEdit tower",
    file: "e6-negative-quadrant.md",
    timeoutMinutes: 30,
    preamble: "guided",
    grade: towerGrader(E6_SPEC),
  },
  {
    id: "b1",
    title: "two-storey tavern with interior (natural request)",
    file: "b1-tavern.md",
    timeoutMinutes: 90,
    preamble: "natural",
    grade: buildGrader({
      reference: "nordic-two-story",
      rubric: "micro",
      expect: {
        ...house,
        minFootprint: { w: 12, d: 9 },
        minHeight: 12,
        minBlocks: 800,
        features: [...(house.features ?? []), "furniture", "fence"],
      },
    }),
  },
  {
    id: "b2",
    title: "stone chapel with bell tower (natural request)",
    file: "b2-chapel-tower.md",
    timeoutMinutes: 90,
    preamble: "natural",
    grade: buildGrader({
      reference: "small-chapel",
      rubric: "micro",
      expect: {
        ...house,
        minFootprint: { w: 11, d: 18 },
        minHeight: 20,
        minBlocks: 1200,
        features: [...(house.features ?? []), "path", "tree", "fence"],
      },
    }),
  },
  {
    id: "b3",
    title: "lighthouse on a rocky cove (natural request)",
    file: "b3-lighthouse-cove.md",
    timeoutMinutes: 120,
    preamble: "natural",
    grade: buildGrader({
      reference: "watchtower",
      rubric: "micro",
      expect: {
        minFootprint: { w: 20, d: 20 },
        minHeight: 22,
        minBlocks: 2500,
        features: ["door", "window", "light", "water", "path", "fence"],
        // A scene with rock and water, so the map allowance applies.
        maxLintWarnings: 2,
        maxRepeatRatio: 0.3,
      },
    }),
  },
  {
    id: "m1",
    title: "castle town on a hill (natural request)",
    file: "m1-castle-town.md",
    timeoutMinutes: 150,
    preamble: "natural",
    grade: buildGrader({
      reference: "small-chapel",
      rubric: "map",
      expect: map(80, ["fence"]),
    }),
  },
  {
    id: "m2",
    title: "harbor island (natural request)",
    file: "m2-harbor-island.md",
    timeoutMinutes: 150,
    preamble: "natural",
    grade: buildGrader({
      reference: "stone-bridge",
      rubric: "map",
      expect: map(96, ["water"]),
    }),
  },
  {
    id: "m3",
    title: "mountain temple, ~50×50×60 (natural request)",
    file: "m3-mountain-temple.md",
    timeoutMinutes: 150,
    preamble: "natural",
    grade: buildGrader({
      reference: "watchtower",
      rubric: "map",
      expect: {
        ...map(50),
        minHeight: 40,
        // A pagoda's layered roofs may be slab-stepped rather than stairs;
        // the trees and gardens on the ledges are asked for, so they stay.
        features: (map(50).features ?? []).filter(
          (feature) => feature !== "roofStairs",
        ),
      },
    }),
  },
  {
    id: "m4",
    title: "river valley village, ~160×160 (natural request)",
    file: "m4-river-valley.md",
    timeoutMinutes: 180,
    preamble: "natural",
    grade: buildGrader({
      reference: "plaza-well",
      rubric: "map",
      expect: map(160, ["water"]),
    }),
  },
  {
    id: "m5",
    title: "walled port city, ~250×250 (natural request)",
    file: "m5-port-city.md",
    timeoutMinutes: 210,
    preamble: "natural",
    grade: buildGrader({
      reference: "market-stall",
      rubric: "map",
      expect: map(250, ["water", "fence"]),
    }),
  },
  {
    id: "m6",
    title: "region map, ~500×500×50 (natural request)",
    file: "m6-region.md",
    timeoutMinutes: 240,
    preamble: "natural",
    grade: buildGrader({
      reference: "stone-bridge",
      rubric: "map",
      expect: map(500, ["water"]),
    }),
  },
];

/** `all` or a comma list of ids (`e1,e3`); unknown ids fail loudly. */
export function selectTasks(spec: string): TaskDef[] {
  if (spec === "all") {
    return [...TASKS];
  }
  return spec.split(",").map((raw) => {
    const id = raw.trim();
    const task = TASKS.find((candidate) => candidate.id === id);
    if (task === undefined) {
      throw new Error(
        `Unknown task "${id}"; choose from ${TASKS.map((candidate) => candidate.id).join(", ")} or all`,
      );
    }
    return task;
  });
}
