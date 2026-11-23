import type {
  PipelineAction,
  PipelineStage,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import type {
  CiRun,
  CiRunIntegration,
  CiWorkflow,
} from "#shared/hub/integration-contract.ts";
import { parseEvidenceSummary } from "#client/evidence.ts";
import { plainCause } from "#shared/evidence/plain-cause.ts";

const PRIORITY: PipelineStatus[] = [
  "failed",
  "running",
  "awaiting_approval",
  "queued",
  "pending",
  "canceled",
  "succeeded",
  "not_started",
];

function rollup(statuses: PipelineStatus[]): PipelineStatus {
  return PRIORITY.find((status) => statuses.includes(status)) ?? "not_started";
}

const WORKFLOW_KEY = "workflow:";

/**
 * A workflow's second line and link. Only a failed workflow is explained by a
 * failed step: Woodpecker also reports a step as failed when it stops a
 * service container at the end of a workflow that succeeded. The link opens
 * a step in the workflow's own state: the one that failed, or is running.
 */
function workflowAction(workflow: CiWorkflow, run: CiRun): PipelineAction {
  const own = workflow.steps.find((step) => step.status === workflow.status);
  const failed = workflow.status === "failed" ? own : undefined;
  return {
    key: `${WORKFLOW_KEY}${String(workflow.pid)}`,
    title: workflow.name,
    status: workflow.status,
    detail:
      failed === undefined
        ? `${String(workflow.steps.length)} ${workflow.steps.length === 1 ? "step" : "steps"}`
        : `Step ${failed.name} exited ${String(failed.exitCode)}`,
    startedAt: workflow.startedAt,
    finishedAt: workflow.finishedAt,
    target: null,
    links: [
      {
        kind: "woodpecker",
        label: `Woodpecker ${workflow.name}`,
        url: (own ?? workflow.steps[0])?.url ?? run.url,
      },
    ],
  };
}

/**
 * The wall-clock span of some workflows: from the first start to the last
 * finish, still open while any started one runs. Null when none started.
 */
export function workflowSpan(workflows: readonly CiWorkflow[]) {
  const started = workflows.flatMap((workflow) =>
    workflow.startedAt === null
      ? []
      : [{ start: workflow.startedAt, end: workflow.finishedAt }],
  );
  const [first] = started.map((entry) => entry.start).toSorted();
  if (first === undefined) return null;
  const ends = started.map((entry) => entry.end);
  const finished = ends.flatMap((end) => (end === null ? [] : [end]));
  return {
    startedAt: first,
    finishedAt:
      finished.length < ends.length
        ? null
        : (finished.toSorted().at(-1) ?? null),
  };
}

/**
 * The qualified run's own action, once its build workflows are known: its
 * duration becomes their wall-clock span instead of Delivery's check.
 */
function spannedRun(action: PipelineAction, builds: readonly CiWorkflow[]) {
  const span = workflowSpan(builds);
  return span === null || action.spanLabel === undefined
    ? action
    : { ...action, ...span, spanLabel: "build workflows" };
}

/**
 * Split the server's Build stage into Build and Test using the latest CI run.
 * Without CI enrichment the server's single Build stage stands as is. With
 * it, the qualified run's duration is its build workflows' wall clock.
 */
export function pipelineStages(
  stages: PipelineStage[],
  ci: CiRunIntegration | undefined,
): PipelineStage[] {
  if (ci?.state !== "available") return stages;
  const run = ci.data;
  return stages.flatMap((stage) => {
    if (stage.kind !== "build") return [stage];
    const tests = run.workflows.filter((workflow) => workflow.stage === "test");
    const builds = run.workflows.filter(
      (workflow) => workflow.stage !== "test",
    );
    // The run Delivery qualified leads; its workflows follow.
    const buildActions = [
      ...stage.actions.map((action) => spannedRun(action, builds)),
      ...builds.map((workflow) => workflowAction(workflow, run)),
    ];
    const testActions = tests.map((workflow) => workflowAction(workflow, run));
    return [
      {
        ...stage,
        status: rollup(buildActions.map((action) => action.status)),
        actions: buildActions,
      },
      {
        ...stage,
        key: "test",
        title: "Test",
        status: rollup(testActions.map((action) => action.status)),
        actions: testActions,
      },
    ];
  });
}

/** Stage-level progress for a compact strip: counts by outcome. */
export function stageSummary(stage: PipelineStage) {
  const done = stage.actions.filter(
    (action) => action.status === "succeeded",
  ).length;
  if (stage.actions.length === 0) return "No runs yet";
  return stage.status === "succeeded"
    ? "All actions succeeded"
    : `${String(done)} of ${String(stage.actions.length)} actions succeeded`;
}

/** A stage lists up to this many actions; a longer list collapses behind its summary. */
/**
 * The line under an action's title. A step reports prose or a machine receipt;
 * a card has room for the prose, and the deployment the title links to shows
 * the receipt as readable facts.
 */
export function actionDetail(action: PipelineAction): string | null {
  if (action.detail === null) return null;
  const message = parseEvidenceSummary(action.detail);
  if (message.kind !== "text") return null;
  // A runtime error's excerpt and frames are not the action's line.
  const words = plainCause(message.text);
  return words === "" ? null : words;
}

export const INLINE_ACTION_LIMIT = 5;

/** The states that open a collapsed list, in the order they lead it. */
const ATTENTION: PipelineStatus[] = ["failed", "running", "awaiting_approval"];

/** What a list counts, and the word for one of them finishing well. */
type Noun = { one: string; many: string; done: string };
const WORKFLOWS: Noun = { one: "workflow", many: "workflows", done: "passed" };
const ARTIFACTS: Noun = {
  one: "artifact",
  many: "artifacts",
  done: "selected",
};
const ACTIONS: Noun = { one: "action", many: "actions", done: "succeeded" };

/** The finished count reads first, then the rest by how much they matter. */
const SUMMARY_ORDER: PipelineStatus[] = [
  "succeeded",
  ...PRIORITY.filter((status) => status !== "succeeded"),
];

function statusWords(status: PipelineStatus, noun: Noun) {
  return status === "succeeded" ? noun.done : status.replaceAll("_", " ");
}

/**
 * Counts by outcome: "14 workflows passed" when every action shares one
 * state, otherwise "12 passed · 1 failed · 1 running".
 */
export function actionSummary(actions: PipelineAction[], noun: Noun = ACTIONS) {
  const counts = SUMMARY_ORDER.map((status) => ({
    status,
    count: actions.filter((action) => action.status === status).length,
  })).filter((entry) => entry.count > 0);
  const [only] = counts;
  if (only !== undefined && counts.length === 1)
    return `${String(only.count)} ${only.count === 1 ? noun.one : noun.many} ${statusWords(only.status, noun)}`;
  return counts
    .map((entry) => `${String(entry.count)} ${statusWords(entry.status, noun)}`)
    .join(" · ");
}

function attentionRank(action: PipelineAction) {
  const rank = ATTENTION.indexOf(action.status);
  return rank === -1 ? ATTENTION.length : rank;
}

export type StageActionList = {
  /** Actions the card always shows, in the stage's own order. */
  inline: PipelineAction[];
  /** The long list behind its summary, or null when the stage shows whole. */
  collapsed: {
    /** What the list holds, for its accessible name: "workflows". */
    label: string;
    summary: string;
    /** Open while an action failed, is running or awaits approval. */
    open: boolean;
    /** Failed, running and waiting actions first, then the stage's order. */
    actions: PipelineAction[];
  } | null;
};

/**
 * How a stage card lists its actions. Up to `INLINE_ACTION_LIMIT` actions
 * show inline, in order. A longer list collapses behind a summary of its
 * outcomes. A CI stage collapses its workflows and keeps the run Delivery
 * qualified inline.
 */
export function stageActionList(stage: PipelineStage): StageActionList {
  const workflows = stage.actions.filter((action) =>
    action.key.startsWith(WORKFLOW_KEY),
  );
  const listed = workflows.length > 0 ? workflows : stage.actions;
  if (listed.length <= INLINE_ACTION_LIMIT)
    return { inline: stage.actions, collapsed: null };
  let noun = ACTIONS;
  if (workflows.length > 0) noun = WORKFLOWS;
  else if (stage.kind === "version") noun = ARTIFACTS;
  return {
    inline: stage.actions.filter((action) => !listed.includes(action)),
    collapsed: {
      label: noun.many,
      summary: actionSummary(listed, noun),
      open: listed.some((action) => ATTENTION.includes(action.status)),
      actions: listed.toSorted(
        (left, right) => attentionRank(left) - attentionRank(right),
      ),
    },
  };
}
