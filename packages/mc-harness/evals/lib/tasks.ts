import { buildGrader } from "#evals/grade/build.ts";
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
    grade: buildGrader("cottage"),
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
    grade: buildGrader("nordic-two-story"),
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
    id: "m1",
    title: "castle town on a hill (natural request)",
    file: "m1-castle-town.md",
    timeoutMinutes: 150,
    preamble: "natural",
    grade: buildGrader("small-chapel"),
  },
  {
    id: "m2",
    title: "harbor island (natural request)",
    file: "m2-harbor-island.md",
    timeoutMinutes: 150,
    preamble: "natural",
    grade: buildGrader("stone-bridge"),
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
