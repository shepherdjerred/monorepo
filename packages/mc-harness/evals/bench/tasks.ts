import type { JudgeRubric } from "#protocol/build.ts";

/**
 * The fixed task set the bench rates. Each build task in `evals/lib/tasks.ts`
 * maps to a rubric; `optional` tasks (the largest maps) are rated only with
 * `--all`, because they cost hours of agent time per entry.
 */
export type BenchTask = { id: string; rubric: JudgeRubric; optional?: true };

export const BENCH_TASKS: readonly BenchTask[] = [
  { id: "e2", rubric: "micro" },
  { id: "e5", rubric: "micro" },
  { id: "b1", rubric: "micro" },
  { id: "b2", rubric: "micro" },
  { id: "b3", rubric: "micro" },
  { id: "m1", rubric: "map" },
  { id: "m2", rubric: "map" },
  { id: "m3", rubric: "map" },
  { id: "m4", rubric: "map" },
  { id: "m5", rubric: "map", optional: true },
  { id: "m6", rubric: "map", optional: true },
];

export function benchTask(id: string): BenchTask {
  const task = BENCH_TASKS.find((candidate) => candidate.id === id);
  if (task === undefined) {
    throw new Error(
      `Unknown bench task "${id}"; choose from ${BENCH_TASKS.map((candidate) => candidate.id).join(", ")}`,
    );
  }
  return task;
}
