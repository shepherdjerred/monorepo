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
  /** The lockfile, which Turbo hashes per package rather than globally. */
  readonly lockfile: string;
  /**
   * Tasks by their `hashOfExternalDependencies`: one group per package whose
   * lockfile closure is its own. An edit to the lockfile changes some groups.
   */
  readonly externalDependencyGroups: ReadonlyMap<string, readonly string[]>;
};

/** Commits per file, and how many root package.json commits changed dependencies. */
export type Churn = {
  readonly commits: ReadonlyMap<string, number>;
  /** Null when unknown: every root package.json commit then counts as global. */
  readonly rootDependencyEdits: number | null;
};

const ROOT_MANIFEST = "package.json";

type Reach = { readonly tasks: number; readonly seconds: number };

/** The average reach of a root package.json commit: dependency edits reach all. */
function rootManifestReach(
  local: Reach,
  global: Reach,
  dependencyEdits: number,
  edits: number,
): Reach {
  const share = dependencyEdits / edits;
  return {
    tasks: Math.round(share * global.tasks + (1 - share) * local.tasks),
    seconds: share * global.seconds + (1 - share) * local.seconds,
  };
}

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
 * times the median miss cost of every task hash they reach. Turbo scopes the
 * lockfile per package, so one edit reaches the average external-dependency
 * group, not every task. A root package.json commit that changes its
 * dependency fields changes the global external-dependency hash, so it reaches
 * every task; any other commit reaches only the root `//#` tasks that list it.
 * When the churn cannot tell the two apart, every such commit counts as
 * global, an upper bound.
 */
export function hotFiles(
  graph: TaskGraph,
  churn: Churn,
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
  const reachedBySet = new Map<string, Reach>();
  const reach = (roots: Iterable<string>) => {
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
    return reached;
  };
  // One lockfile edit changes some packages' closures, not all: average the
  // reach of each external-dependency group.
  const groups = [...graph.externalDependencyGroups.values()].map((tasks) =>
    reach(tasks),
  );
  const lockfileReach = {
    tasks: Math.round(
      groups.reduce((sum, group) => sum + group.tasks, 0) / groups.length,
    ),
    seconds:
      groups.reduce((sum, group) => sum + group.seconds, 0) / groups.length,
  };
  const allReach = reach(allTasks);
  const reachOf = (file: string, editCount: number): Reach | undefined => {
    const roots = direct.get(file);
    if (file === graph.lockfile && groups.length > 0) return lockfileReach;
    if (file === ROOT_MANIFEST && roots !== undefined)
      return rootManifestReach(
        reach(roots),
        allReach,
        churn.rootDependencyEdits === null
          ? editCount
          : Math.min(churn.rootDependencyEdits, editCount),
        editCount,
      );
    return roots === undefined ? undefined : reach(roots);
  };
  const ranked: HotFile[] = [];
  for (const [file, editCount] of churn.commits) {
    if (editCount === 0) continue;
    const reached = reachOf(file, editCount);
    if (reached === undefined) continue;
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

export const MISS_CAUSES = [
  "own-inputs-changed",
  "upstream-changed",
  "no-own-or-upstream-change",
  "identical-hash-rerun",
  "unknown-first-seen-in-window",
] as const;
export type MissCause = (typeof MISS_CAUSES)[number];

export type MissCauseRow = {
  readonly cause: MissCause;
  readonly misses: number;
  readonly hours: number;
  /** Share of all executed (MISS) task seconds in the window. */
  readonly share: number;
};

type RunTask = VerifyRun["tasks"][number];

/**
 * Why a task executed, against the tasks with the same id that started before
 * it (start order, so concurrent pipelines count):
 *
 * - identical-hash-rerun: any earlier task already had this exact hash, so the
 *   work was cacheable; cache isolation (PR versus main), a lost artifact or a
 *   concurrent duplicate. Checked first so an intervening different hash
 *   cannot hide it.
 * - unknown-first-seen-in-window: no earlier task with this id in the window,
 *   so the window edge, not a change, is why it has no predecessor.
 * - own-inputs-changed: earlier tasks exist, none with these own inputs.
 * - upstream-changed: the latest earlier task with the same own inputs had
 *   different dependency hashes.
 * - no-own-or-upstream-change: same own inputs and dependency hashes, yet a
 *   different hash, so the global hash, environment or task config moved.
 */
function classifyMiss(task: RunTask, earlier: readonly RunTask[]): MissCause {
  if (earlier.some((candidate) => candidate.hash === task.hash))
    return "identical-hash-rerun";
  if (earlier.length === 0) return "unknown-first-seen-in-window";
  const previous = latestStarted(
    earlier.filter((candidate) => candidate.ownInputs === task.ownInputs),
  );
  if (previous === undefined) return "own-inputs-changed";
  return previous.upstream === task.upstream
    ? "no-own-or-upstream-change"
    : "upstream-changed";
}

/** Why executed tasks ran, with hours and share of executed time per cause. */
export function missCauses(runs: readonly VerifyRun[]): MissCauseRow[] {
  const byId = new Map<string, RunTask[]>();
  for (const task of runs.flatMap((run) => run.tasks))
    byId.set(task.id, [...(byId.get(task.id) ?? []), task]);
  const totals = new Map<MissCause, { count: number; seconds: number }>(
    MISS_CAUSES.map((cause) => [cause, { count: 0, seconds: 0 }]),
  );
  for (const task of runs.flatMap((run) => run.tasks)) {
    if (task.status !== "MISS") continue;
    const earlier = (byId.get(task.id) ?? []).filter(
      (candidate) => candidate !== task && candidate.start < task.start,
    );
    const total = totals.get(classifyMiss(task, earlier));
    if (total === undefined) throw new Error("Unknown miss cause");
    total.count += 1;
    total.seconds += task.seconds;
  }
  const allSeconds = [...totals.values()].reduce(
    (sum, total) => sum + total.seconds,
    0,
  );
  return MISS_CAUSES.map((cause) => {
    const total = totals.get(cause) ?? { count: 0, seconds: 0 };
    return {
      cause,
      misses: total.count,
      hours: total.seconds / 3600,
      share: allSeconds === 0 ? 0 : total.seconds / allSeconds,
    };
  });
}

function latestStarted(candidates: readonly RunTask[]): RunTask | undefined {
  return candidates.reduce<RunTask | undefined>(
    (latest, candidate) =>
      latest === undefined || candidate.start > latest.start
        ? candidate
        : latest,
    undefined,
  );
}
