import type { CiStep, StepEvent } from "#src/pipeline/model.ts";

export type SelectionContext = {
  readonly event: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly changedFiles: readonly string[];
};

function matchesAny(patterns: readonly string[], file: string): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(file));
}

function normalizeEvent(event: string): StepEvent | undefined {
  return event === "push" || event === "pull_request" ? event : undefined;
}

/**
 * Events that may run a step marked `defaultBranchOnly`.
 *
 * An allowlist rather than "anything that is not a pull request", so that
 * every event this model does not reason about -- `tag`, `release`,
 * `deployment`, `cron`, and the three pull-request shapes Woodpecker sends --
 * fails closed. These steps apply infrastructure, publish packages and
 * reconcile ArgoCD; running one from an unconsidered trigger is far worse than
 * not running it.
 *
 * `manual` is included because it is the UI's Trigger Pipeline button, which
 * only an account that can sign in can reach and which the extension's actor
 * allowlist filters again. Restarting a failed build preserves that build's
 * original event, so ordinary re-runs of a release arrive here as `push`.
 */
const DEFAULT_BRANCH_EVENTS = new Set(["push", "manual"]);

/**
 * Is this build the default branch itself, rather than a proposal to change
 * it?
 *
 * Branch identity alone cannot answer that, which is the bug this function
 * exists to prevent recurring. Woodpecker sets `pipeline.branch` to the TARGET
 * branch for every pull-request event, so a pull request against `main`
 * reports `main` here and passed the original branch-equality check -- placing
 * the entire release chain, and every credential it holds, inside reach of any
 * pull request.
 */
function onDefaultBranch(context: SelectionContext): boolean {
  return (
    context.branch === context.defaultBranch &&
    DEFAULT_BRANCH_EVENTS.has(context.event)
  );
}

/**
 * Does this step's changed-path guard match?
 *
 * An empty changed-file list means "we could not determine what changed" — a
 * tag build, a forge that truncated the list, a push with no diff reported.
 * That must select the step, not skip it: a release lane that silently does
 * nothing and reports success is far worse than one that runs redundantly.
 */
export function changedGuardMatches(
  step: CiStep,
  changedFiles: readonly string[],
): boolean {
  if (step.changed === undefined) return true;
  if (changedFiles.length === 0) return true;

  const { include, exclude } = step.changed;
  const candidates =
    exclude === undefined
      ? changedFiles
      : changedFiles.filter((file) => !matchesAny(exclude, file));
  return include === undefined
    ? candidates.length > 0
    : candidates.some((file) => matchesAny(include, file));
}

function directlySelected(step: CiStep, context: SelectionContext): boolean {
  if (step.defaultBranchOnly === true && !onDefaultBranch(context)) {
    return false;
  }
  if (step.events !== undefined) {
    const event = normalizeEvent(context.event);
    if (event === undefined || !step.events.includes(event)) return false;
  }
  return changedGuardMatches(step, context.changedFiles);
}

/**
 * Select the steps this build must run, closed over their dependencies.
 *
 * Closure is the part that matters: a step selected by its own changed-path
 * guard is useless if the step that produces its input was filtered out. The
 * Buildkite selector had the same rule, and the emitter depends on it — the
 * generated workflows carry `depends_on` with no `when`, so a dependency that
 * was not emitted would leave its dependent permanently unrunnable.
 *
 * Throws on an unknown dependency or a cycle rather than dropping the edge: a
 * malformed graph is a bug in the pipeline definition, and silently running a
 * subset of CI is exactly the failure this whole layer exists to prevent.
 */
export function selectSteps(
  steps: readonly CiStep[],
  context: SelectionContext,
): CiStep[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  if (byKey.size !== steps.length) {
    throw new Error("duplicate step key in pipeline definition");
  }

  for (const step of steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!byKey.has(dependency)) {
        throw new Error(
          `step ${step.key} depends on unknown step ${dependency}`,
        );
      }
    }
  }

  assertAcyclic(steps, byKey);

  const selected = new Set<string>();
  const visit = (key: string): void => {
    if (selected.has(key)) return;
    selected.add(key);
    const step = byKey.get(key);
    if (step === undefined) return;
    for (const dependency of step.dependsOn ?? []) visit(dependency);
  };

  for (const step of steps) {
    if (directlySelected(step, context)) visit(step.key);
  }

  // Preserve definition order so the emitted set is deterministic.
  return steps.filter((step) => selected.has(step.key));
}

function assertAcyclic(
  steps: readonly CiStep[],
  byKey: ReadonlyMap<string, CiStep>,
): void {
  const state = new Map<string, "visiting" | "done">();
  const walk = (key: string, trail: readonly string[]): void => {
    const current = state.get(key);
    if (current === "done") return;
    if (current === "visiting") {
      throw new Error(
        `dependency cycle in pipeline definition: ${[...trail, key].join(" -> ")}`,
      );
    }
    state.set(key, "visiting");
    for (const dependency of byKey.get(key)?.dependsOn ?? []) {
      walk(dependency, [...trail, key]);
    }
    state.set(key, "done");
  };
  for (const step of steps) walk(step.key, []);
}
