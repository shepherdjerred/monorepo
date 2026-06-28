/**
 * Phase-0 local PoC for the PR babysitter (no Temporal, no cluster).
 *
 * Runs the babysit loop against ONE real open PR from your machine, pushing
 * fixes to its branch, to validate the loop + mutating agent + DoD logic and —
 * the whole point — MEASURE real $/iteration and $/PR before any infra is built.
 *
 * Auth:
 *   - `gh` uses your local `gh auth` (no GH_TOKEN needed); git push uses your
 *     `gh auth setup-git` credential helper.
 *   - The agent needs `CLAUDE_CODE_OAUTH_TOKEN` in the env.
 *
 * Usage:
 *   CLAUDE_CODE_OAUTH_TOKEN=… bun run scripts/run-pr-babysit-local.ts --pr 1234
 *   … --pr 1234 --dry-run               # agent runs + commits locally, never pushes
 *   … --pr 1234 --max-iterations 3 --model claude-opus-4-8 --goal "keep the refactor intent"
 *
 * The repo defaults to shepherdjerred/monorepo; override with --repo owner/name.
 */
import { ensureBabysitWorkdir } from "#activities/pr-babysit/ensure-workdir.ts";
import { evaluateBabysitDoD } from "#activities/pr-babysit/evaluate-dod.ts";
import { runBabysitIteration } from "#activities/pr-babysit/iteration.ts";
import { getPrSnapshot } from "#activities/pr-babysit/github.ts";
import { pushBabysitBranch } from "#activities/pr-babysit/push.ts";
import {
  decideNextAction,
  type BudgetState,
} from "#shared/pr-babysit/loop-policy.ts";
import { failureSignature } from "#shared/pr-babysit/prompt.ts";
import {
  PrBabysitInputSchema,
  type BabysitVerdict,
  type PrBabysitInput,
} from "#shared/pr-babysit/types.ts";

type Args = {
  repo: string;
  prNumber: number;
  dryRun: boolean;
  maxIterations: number | undefined;
  model: string | undefined;
  goal: string | undefined;
  pollSeconds: number;
  postPushSeconds: number;
};

function parseArgs(argv: readonly string[]): Args {
  let repo = "shepherdjerred/monorepo";
  let prNumber: number | undefined;
  let dryRun = false;
  let maxIterations: number | undefined;
  let model: string | undefined;
  let goal: string | undefined;
  let pollSeconds = 30;
  let postPushSeconds = 45;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      return v;
    };
    switch (arg) {
      case "--pr":
        prNumber = Number(next());
        break;
      case "--repo":
        repo = next();
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--max-iterations":
        maxIterations = Number(next());
        break;
      case "--model":
        model = next();
        break;
      case "--goal":
        goal = next();
        break;
      case "--poll-seconds":
        pollSeconds = Number(next());
        break;
      case "--post-push-seconds":
        postPushSeconds = Number(next());
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (prNumber === undefined || !Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error("--pr <number> is required");
  }
  return {
    repo,
    prNumber,
    dryRun,
    maxIterations,
    model,
    goal,
    pollSeconds,
    postPushSeconds,
  };
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.warn(
    JSON.stringify({
      level: "info",
      component: "pr-babysit-local",
      msg: message,
      ...fields,
    }),
  );
}

function logVerdict(verdict: BabysitVerdict): void {
  log("verdict", {
    headSha: verdict.headSha.slice(0, 9),
    prState: verdict.prState,
    dodMet: verdict.dodMet,
    ciFailing: verdict.ci.failing,
    ciPending: verdict.ci.pending,
    ciIgnoredSoft: verdict.ci.ignoredSoft,
    conflicts: verdict.conflicts.clean ? "clean" : verdict.conflicts.paths,
    blocking: verdict.reviews.blocking.map(
      (t) => `${t.severity ?? "P?"}:${t.threadId}`,
    ),
    advisory: verdict.reviews.advisory.length,
  });
}

type LoopContext = {
  owner: string;
  repo: string;
  input: PrBabysitInput;
  workflowId: string;
  args: Args;
};

/** Drive the assess → act → push → wait loop until a terminal decision. */
async function runBabysitLoop(ctx: LoopContext): Promise<void> {
  const { owner, repo, input, workflowId, args } = ctx;
  const start = Date.now();
  const state: {
    iterationsTotal: number;
    costUsd: number;
    recentSignatures: string[];
  } = {
    iterationsTotal: 0,
    costUsd: 0,
    recentSignatures: [],
  };
  let announced = false;

  for (;;) {
    // Start every iteration from a clean reset to origin/<headRef> so a prior
    // remote-moved push (a human pushed mid-iteration) is reconciled — we never
    // assess or fix against stale local state.
    const { workdir } = await ensureBabysitWorkdir({
      owner,
      repo,
      headRef: input.headRef,
      baseRef: input.baseRef,
      workflowId,
      isCrossRepository: false,
    });
    if (!announced) {
      log("workdir ready", { workdir });
      announced = true;
    }

    const verdict = await evaluateBabysitDoD({
      owner,
      repo,
      prNumber: args.prNumber,
      baseRef: input.baseRef,
      workdir,
      blockingSeverity: input.blockingSeverity,
    });
    logVerdict(verdict);

    const budgetState: BudgetState = {
      iterationsTotal: state.iterationsTotal,
      costUsd: state.costUsd,
      elapsedMinutes: (Date.now() - start) / 60_000,
      recentSignatures: state.recentSignatures,
    };
    const decision = decideNextAction(verdict, input.budget, budgetState);

    if (decision.kind === "done") {
      log("DONE — PR meets the definition of done ✅", {
        iterations: state.iterationsTotal,
        costUsd: Number(state.costUsd.toFixed(4)),
      });
      return;
    }
    if (decision.kind === "closed") {
      log("PR closed/merged — standing down", { reason: decision.reason });
      return;
    }
    if (decision.kind === "standdown") {
      log("STANDING DOWN", {
        reason: decision.reason,
        iterations: state.iterationsTotal,
        costUsd: Number(state.costUsd.toFixed(4)),
      });
      return;
    }
    if (decision.kind === "wait") {
      log("waiting for CI", {
        reason: decision.reason,
        pollSeconds: args.pollSeconds,
      });
      await Bun.sleep(args.pollSeconds * 1000);
      continue;
    }

    // decision.kind === "act"
    state.recentSignatures.push(failureSignature(verdict));
    const { result, cost } = await runBabysitIteration({
      input,
      verdict,
      workdir,
      startToCloseTimeoutMs: input.budget.perIterationTimeoutMinutes * 60_000,
    });
    state.iterationsTotal += 1;
    state.costUsd += cost.costUsd ?? 0;
    log("iteration done", {
      iteration: state.iterationsTotal,
      committed: result.committed,
      changedPaths: result.changedPaths,
      summary: result.summary,
      costUsd: cost.costUsd,
      numTurns: cost.numTurns,
      cumulativeCostUsd: Number(state.costUsd.toFixed(4)),
    });

    if (result.needsGuidance || result.intentConflict) {
      log("ESCALATION — agent needs human guidance ⚠️", {
        intentConflict: result.intentConflict,
        question: result.guidanceQuestion,
        escalationReason: result.escalationReason,
      });
      return;
    }

    await pushIfCommitted(result, workdir, ctx);
  }
}

/** Push the iteration's commit (if any) and wait for CI to register. */
async function pushIfCommitted(
  result: { committed: boolean; changedPaths: string[] },
  workdir: string,
  ctx: LoopContext,
): Promise<void> {
  const { input, args } = ctx;
  if (result.committed && args.dryRun) {
    log("dry-run: skipping push (agent committed locally)", {
      changedPaths: result.changedPaths,
    });
    return;
  }
  if (result.committed) {
    const push = await pushBabysitBranch({ workdir, headRef: input.headRef });
    log("push result", { ...push });
    if (push.pushed) {
      log("waiting for CI to register after push", {
        postPushSeconds: args.postPushSeconds,
      });
      await Bun.sleep(args.postPushSeconds * 1000);
    }
    return;
  }
  log("no commit this iteration; short wait before re-assess");
  await Bun.sleep(args.pollSeconds * 1000);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [owner, repoName] = args.repo.split("/");
  if (owner === undefined || repoName === undefined) {
    throw new Error(`--repo must be owner/name, got: ${args.repo}`);
  }

  const snapshot = await getPrSnapshot({
    owner,
    repo: repoName,
    prNumber: args.prNumber,
  });
  log("resolved PR", { ...snapshot });
  if (snapshot.prState !== "open") {
    log("PR is not open; nothing to babysit", { prState: snapshot.prState });
    return;
  }
  if (snapshot.isCrossRepository) {
    log("PR head is in a fork; babysitter only supports same-repo branches", {
      headRef: snapshot.headRef,
      headRepoOwner: snapshot.headRepoOwner,
    });
    return;
  }

  const input: PrBabysitInput = PrBabysitInputSchema.parse({
    owner,
    repo: repoName,
    prNumber: args.prNumber,
    headRef: snapshot.headRef,
    baseRef: snapshot.baseRef,
    ...(args.goal === undefined ? {} : { goal: args.goal }),
    ...(args.model === undefined ? {} : { model: args.model }),
    budget:
      args.maxIterations === undefined
        ? {}
        : { maxIterations: args.maxIterations },
  });

  const workflowId = `pr-babysit-${owner}-${repoName}-${String(args.prNumber)}`;
  await runBabysitLoop({ owner, repo: repoName, input, workflowId, args });
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
