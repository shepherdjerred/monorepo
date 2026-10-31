import { distribution } from "#lib/ci/latency.ts";
import type { VerifyRun } from "./runs.ts";

export type UncachedTask = {
  readonly task: string;
  readonly runs: number;
  readonly totalSeconds: number;
  readonly p50Seconds: number | null;
  readonly maxSeconds: number;
};

/** Executed (cache-missing) work by task, largest total first. */
export function uncachedTasks(runs: readonly VerifyRun[]): UncachedTask[] {
  const byTask = new Map<string, number[]>();
  for (const run of runs) {
    for (const task of run.tasks) {
      if (task.status !== "MISS") continue;
      byTask.set(task.id, [...(byTask.get(task.id) ?? []), task.seconds]);
    }
  }
  return [...byTask]
    .map(([task, seconds]) => ({
      task,
      runs: seconds.length,
      totalSeconds: seconds.reduce((sum, value) => sum + value, 0),
      p50Seconds: distribution(seconds).p50Seconds,
      maxSeconds: Math.max(...seconds),
    }))
    .toSorted((left, right) => right.totalSeconds - left.totalSeconds);
}

/** Median executed seconds per task, the cost a cache miss is expected to pay. */
export function missCosts(runs: readonly VerifyRun[]): Map<string, number> {
  return new Map(
    uncachedTasks(runs).map((task) => [task.task, task.p50Seconds ?? 0]),
  );
}

export type CriticalTask = {
  readonly task: string;
  /** Runs whose last executed task this was. */
  readonly runs: number;
  readonly medianWallSeconds: number | null;
};

/** The task that finished each run last, and how long those runs took. */
export function criticalTasks(runs: readonly VerifyRun[]): CriticalTask[] {
  const walls = new Map<string, number[]>();
  for (const run of runs) {
    const executed = run.tasks.filter((task) => task.status === "MISS");
    if (executed.length === 0) continue;
    const start = Math.min(...executed.map((task) => task.start));
    const last = executed.reduce((latest, task) =>
      task.end > latest.end ? task : latest,
    );
    walls.set(last.id, [
      ...(walls.get(last.id) ?? []),
      (last.end - start) / 1000,
    ]);
  }
  return [...walls]
    .map(([task, seconds]) => ({
      task,
      runs: seconds.length,
      medianWallSeconds: distribution(seconds).p50Seconds,
    }))
    .toSorted((left, right) => right.runs - left.runs);
}

export type RepeatedMiss = {
  readonly task: string;
  readonly misses: number;
  /** Misses whose own inputs an earlier, finished run had already executed. */
  readonly repeated: number;
  readonly repeatedSeconds: number;
};

/**
 * Misses re-running a task whose own files and external dependencies were
 * byte-identical in an earlier finished run. Only an upstream task hash
 * (dependsOn), the global hash, or the cache namespace differed, so these are
 * where dependency fan-out or cache isolation re-ran work.
 */
export function repeatedMisses(runs: readonly VerifyRun[]): RepeatedMiss[] {
  const finished = finishedInputs(runs);
  const byTask = new Map<string, RepeatedMiss>();
  for (const run of runs) {
    for (const task of run.tasks) {
      if (task.status !== "MISS") continue;
      const earlier = (
        finished.get(`${task.id}\0${task.ownInputs}`) ?? []
      ).some((end) => end < task.start);
      byTask.set(task.id, addMiss(byTask.get(task.id), task, earlier));
    }
  }
  return [...byTask.values()]
    .filter((entry) => entry.repeated > 0)
    .toSorted((left, right) => right.repeatedSeconds - left.repeatedSeconds);
}

/** When each task with each set of own inputs finished executing. */
function finishedInputs(runs: readonly VerifyRun[]): Map<string, number[]> {
  const finished = new Map<string, number[]>();
  for (const run of runs) {
    for (const task of run.tasks) {
      if (task.status === "HIT") continue;
      const key = `${task.id}\0${task.ownInputs}`;
      finished.set(key, [...(finished.get(key) ?? []), task.end]);
    }
  }
  return finished;
}

function addMiss(
  current: RepeatedMiss | undefined,
  task: VerifyRun["tasks"][number],
  repeated: boolean,
): RepeatedMiss {
  return {
    task: task.id,
    misses: (current?.misses ?? 0) + 1,
    repeated: (current?.repeated ?? 0) + (repeated ? 1 : 0),
    repeatedSeconds:
      (current?.repeatedSeconds ?? 0) + (repeated ? task.seconds : 0),
  };
}

export type TaskGraph = {
  /** Repository-relative input paths each task hashes. */
  readonly inputs: ReadonlyMap<string, readonly string[]>;
  /** Tasks whose hash includes each task's hash. */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
  /** Tasks with no package script: they link hashes but execute nothing. */
  readonly transit: ReadonlySet<string>;
  /** Files every task hash includes. */
  readonly globalFiles: readonly string[];
};

export type HotFile = {
  readonly file: string;
  readonly commits: number;
  /** Tasks whose hash the file reaches, directly or through dependsOn. */
  readonly tasks: number;
  /** Median miss cost of those tasks: what one edit re-runs. */
  readonly secondsPerEdit: number;
  /** Expected executed seconds per week from this file's edits. */
  readonly weeklySeconds: number;
};

function reachableTasks(
  graph: TaskGraph,
  roots: readonly string[],
): Set<string> {
  const seen = new Set<string>();
  const pending = [...roots];
  for (let task = pending.pop(); task !== undefined; task = pending.pop()) {
    if (seen.has(task)) continue;
    seen.add(task);
    pending.push(...(graph.dependents.get(task) ?? []));
  }
  return seen;
}

/**
 * Files ranked by the executed work their edits cause: commits in the window
 * times the median miss cost of every task hash they reach.
 */
export function hotFiles(
  graph: TaskGraph,
  commits: ReadonlyMap<string, number>,
  costs: ReadonlyMap<string, number>,
  windowDays: number,
): HotFile[] {
  const direct = new Map<string, Set<string>>();
  const allTasks = [...graph.inputs.keys()];
  for (const file of graph.globalFiles) direct.set(file, new Set(allTasks));
  for (const [task, files] of graph.inputs) {
    for (const file of files) {
      const tasks = direct.get(file) ?? new Set<string>();
      tasks.add(task);
      direct.set(file, tasks);
    }
  }
  // Most files share their direct task set with the rest of their package.
  const reachedBySet = new Map<string, { tasks: number; seconds: number }>();
  const ranked: HotFile[] = [];
  for (const [file, editCount] of commits) {
    const roots = direct.get(file);
    if (roots === undefined || editCount === 0) continue;
    const key = [...roots].toSorted().join("\n");
    let reached = reachedBySet.get(key);
    if (reached === undefined) {
      const tasks = reachableTasks(graph, [...roots]);
      reached = {
        tasks: tasks.size,
        seconds: [...tasks].reduce(
          (sum, task) =>
            sum + (graph.transit.has(task) ? 0 : (costs.get(task) ?? 0)),
          0,
        ),
      };
      reachedBySet.set(key, reached);
    }
    ranked.push({
      file,
      commits: editCount,
      tasks: reached.tasks,
      secondsPerEdit: reached.seconds,
      weeklySeconds: (editCount * reached.seconds * 7) / windowDays,
    });
  }
  return ranked.toSorted(
    (left, right) => right.weeklySeconds - left.weeklySeconds,
  );
}
