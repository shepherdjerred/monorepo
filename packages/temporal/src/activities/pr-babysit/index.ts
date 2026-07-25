/**
 * Worker activity surface for `prBabysitWorkflow`. Thin wrappers that inject a
 * freshly-minted GitHub App token into the pure Phase-0 functions (which the
 * local PoC calls directly with ambient credentials), and thread the Temporal
 * activity timeout / cancellation signal into the mutating iteration.
 */
import { Context } from "@temporalio/activity";
import { babysitWorkdirPath, ensureBabysitWorkdir } from "./ensure-workdir.ts";
import { evaluateBabysitDoD } from "./evaluate-dod.ts";
import {
  runBabysitIteration,
  type RunBabysitIterationResult,
} from "./iteration.ts";
import { pushBabysitBranch, type PushBabysitBranchResult } from "./push.ts";
import { postBabysitStatus } from "./comment.ts";
import { mintBabysitAuth } from "./runtime.ts";
import { run } from "./exec.ts";
import type {
  BabysitVerdict,
  PrBabysitInput,
  ReviewSeverity,
} from "#shared/pr-babysit/types.ts";

function startToCloseMs(): number | undefined {
  try {
    return Context.current().info.startToCloseTimeoutMs;
  } catch {
    return undefined;
  }
}

function cancelSignal(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

export type AssessBabysitInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headRef: string;
  baseRef: string;
  workflowId: string;
  blockingSeverity: ReviewSeverity;
};

/**
 * Self-ensuring DoD gate: (re)create the per-PR workdir from origin, then run
 * the deterministic evaluation against it. Ensure is INTERNAL — the workdir on
 * pod-local `/tmp` does not survive a worker restart, so folding the ensure in
 * here means a Temporal retry on a fresh pod re-clones instead of crashing on a
 * missing directory. `ensureBabysitWorkdir` is idempotent (cold → blobless
 * clone; warm → fetch + `reset --hard origin/<headRef>`), so re-ensuring on
 * every call is cheap when the tree is already present.
 */
async function assess(input: AssessBabysitInput): Promise<BabysitVerdict> {
  const { token, env } = await mintBabysitAuth();
  // The ingress only starts a babysitter for same-repo PRs (forks are refused
  // up front), so the head ref is always reachable on origin here.
  const { workdir } = await ensureBabysitWorkdir({
    owner: input.owner,
    repo: input.repo,
    headRef: input.headRef,
    baseRef: input.baseRef,
    workflowId: input.workflowId,
    token,
    isCrossRepository: false,
  });
  return evaluateBabysitDoD({
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    baseRef: input.baseRef,
    workdir,
    blockingSeverity: input.blockingSeverity,
    env,
  });
}

export type RunBabysitIterationActivityInput = {
  input: PrBabysitInput;
  verdict: BabysitVerdict;
  /** Stable per-PR id; the workdir is (re)derived + re-ensured from it. */
  workflowId: string;
  guidance?: string;
};

export type RunBabysitIterationActivityResult = RunBabysitIterationResult & {
  /** Present iff the agent committed and a push was attempted. */
  push?: PushBabysitBranchResult;
};

/**
 * Self-contained iteration: (re)ensure the workdir from origin, run the mutating
 * agent turn (which commits but does not push), then push under a freshly minted
 * token. Folding the push in here makes the pushed commit on origin the ONLY
 * durable cross-activity handoff — an agent commit never lives solely on a local
 * pod disk that a restart could wipe. A retry of this activity safely re-clones
 * from origin and redoes the turn.
 */
async function iterate(
  args: RunBabysitIterationActivityInput,
): Promise<RunBabysitIterationActivityResult> {
  const { token, env } = await mintBabysitAuth();
  const { workdir } = await ensureBabysitWorkdir({
    owner: args.input.owner,
    repo: args.input.repo,
    headRef: args.input.headRef,
    baseRef: args.input.baseRef,
    workflowId: args.workflowId,
    token,
    isCrossRepository: false,
  });

  const timeout = startToCloseMs();
  const signal = cancelSignal();
  const { result, cost } = await runBabysitIteration({
    input: args.input,
    verdict: args.verdict,
    workdir,
    env,
    ...(args.guidance === undefined ? {} : { guidance: args.guidance }),
    ...(timeout === undefined ? {} : { startToCloseTimeoutMs: timeout }),
    ...(signal === undefined ? {} : { cancellationSignal: signal }),
  });

  if (!result.committed) {
    return { result, cost };
  }

  // Re-mint before the push: the agent turn can run up to the per-iteration
  // timeout (tens of minutes), so the start-of-activity installation token may
  // be near its ~1h TTL. Cheap, and preserves the "push always uses a fresh
  // token" guarantee.
  const { env: pushEnv } = await mintBabysitAuth();
  const push = await pushBabysitBranch({
    workdir,
    headRef: args.input.headRef,
    env: pushEnv,
  });
  return { result, cost, push };
}

async function cleanup(input: { workflowId: string }): Promise<void> {
  const workdir = babysitWorkdirPath(input.workflowId);
  if (workdir.startsWith("/tmp/")) {
    await run(["rm", "-rf", workdir]);
  }
}

export const prBabysitActivities = {
  // Self-ensuring gate (was prepareBabysitWorkdir + evaluateBabysitDoD).
  assessBabysit: assess,
  // Self-contained: ensure workdir + agent turn + push (was runBabysitIteration
  // + a separate pushBabysitBranch).
  runBabysitIteration: iterate,
  postBabysitStatus,
  cleanupBabysitWorkdir: cleanup,
};

export type PrBabysitActivities = typeof prBabysitActivities;
