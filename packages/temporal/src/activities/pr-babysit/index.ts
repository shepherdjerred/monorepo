/**
 * Worker activity surface for `prBabysitWorkflow`. Thin wrappers that inject a
 * freshly-minted GitHub App token into the pure Phase-0 functions (which the
 * local PoC calls directly with ambient credentials), and thread the Temporal
 * activity timeout / cancellation signal into the mutating iteration.
 */
import { Context } from "@temporalio/activity";
import {
  babysitWorkdirPath,
  ensureBabysitWorkdir,
  type EnsureBabysitWorkdirResult,
} from "./ensure-workdir.ts";
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

export type PrepareBabysitWorkdirInput = {
  owner: string;
  repo: string;
  headRef: string;
  baseRef: string;
  workflowId: string;
};

async function prepareWorkdir(
  input: PrepareBabysitWorkdirInput,
): Promise<EnsureBabysitWorkdirResult> {
  const { token } = await mintBabysitAuth();
  // The ingress only starts a babysitter for same-repo PRs (forks are refused
  // up front), so the head ref is always reachable on origin here.
  return ensureBabysitWorkdir({ ...input, token, isCrossRepository: false });
}

export type EvaluateBabysitInput = {
  owner: string;
  repo: string;
  prNumber: number;
  baseRef: string;
  workdir: string;
  blockingSeverity: ReviewSeverity;
};

async function evaluate(input: EvaluateBabysitInput): Promise<BabysitVerdict> {
  const { env } = await mintBabysitAuth();
  return evaluateBabysitDoD({ ...input, env });
}

export type RunBabysitIterationActivityInput = {
  input: PrBabysitInput;
  verdict: BabysitVerdict;
  workdir: string;
  guidance?: string;
};

async function iterate(
  args: RunBabysitIterationActivityInput,
): Promise<RunBabysitIterationResult> {
  const { env } = await mintBabysitAuth();
  const timeout = startToCloseMs();
  const signal = cancelSignal();
  return runBabysitIteration({
    input: args.input,
    verdict: args.verdict,
    workdir: args.workdir,
    env,
    ...(args.guidance === undefined ? {} : { guidance: args.guidance }),
    ...(timeout === undefined ? {} : { startToCloseTimeoutMs: timeout }),
    ...(signal === undefined ? {} : { cancellationSignal: signal }),
  });
}

export type PushBabysitInput = {
  workdir: string;
  headRef: string;
};

async function push(input: PushBabysitInput): Promise<PushBabysitBranchResult> {
  const { env } = await mintBabysitAuth();
  return pushBabysitBranch({ ...input, env });
}

async function cleanup(input: { workflowId: string }): Promise<void> {
  const workdir = babysitWorkdirPath(input.workflowId);
  if (workdir.startsWith("/tmp/")) {
    await run(["rm", "-rf", workdir]);
  }
}

export const prBabysitActivities = {
  prepareBabysitWorkdir: prepareWorkdir,
  evaluateBabysitDoD: evaluate,
  runBabysitIteration: iterate,
  pushBabysitBranch: push,
  postBabysitStatus,
  cleanupBabysitWorkdir: cleanup,
};

export type PrBabysitActivities = typeof prBabysitActivities;
