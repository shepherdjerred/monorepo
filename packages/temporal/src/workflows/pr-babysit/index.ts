/**
 * `prBabysitWorkflow` — the durable per-PR babysitter loop.
 *
 * One workflow per PR. Event-driven: it wakes on webhook signals (CI completed,
 * branch pushed, review activity, main advanced, guidance, stop) and only spends
 * a (costly) mutating agent turn when the deterministic DoD says the PR is
 * actually broken. The loop policy (`decideNextAction`) is the SAME pure
 * function the local PoC uses, so behaviour matches end to end. History is
 * bounded with `continueAsNew`; cumulative budget + wall-clock survive the
 * recycle via carried `resume` state.
 */
import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type { PrBabysitActivities } from "#activities/pr-babysit/index.ts";
import { decideNextAction } from "#shared/pr-babysit/loop-policy.ts";
import { failureSignature } from "#shared/pr-babysit/prompt.ts";
import type { BabysitVerdict } from "#shared/pr-babysit/types.ts";
import {
  BABYSIT_SIGNALS,
  BABYSIT_STATUS_QUERY,
  type BabysitPhase,
  type BabysitStatus,
  type GuidanceSignal,
  type PrBabysitWorkflowInput,
  type StopSignal,
} from "#shared/pr-babysit/workflow-types.ts";

/** Loop iterations per workflow run before `continueAsNew` bounds history. */
const ITERATIONS_PER_RUN = 20;
/** Green-state wait; wakes early on any disturbing signal. */
const LIGHT_MONITOR_MS = 20 * 60 * 1000;
/** Bounds the awaiting-CI wait so a dropped webhook can't wedge the loop. */
const ACTIVE_POLL_MS = 150 * 1000;
/** How long to block on a human guidance reply before standing down. */
const GUIDANCE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const ciCompletedSignal = defineSignal<[unknown]>(BABYSIT_SIGNALS.ciCompleted);
const branchPushedSignal = defineSignal<[unknown]>(
  BABYSIT_SIGNALS.branchPushed,
);
const reviewActivitySignal = defineSignal<[unknown]>(
  BABYSIT_SIGNALS.reviewActivity,
);
const mainAdvancedSignal = defineSignal<[unknown]>(
  BABYSIT_SIGNALS.mainAdvanced,
);
const guidanceSignal = defineSignal<[GuidanceSignal]>(BABYSIT_SIGNALS.guidance);
const stopSignal = defineSignal<[StopSignal]>(BABYSIT_SIGNALS.stop);
const statusQuery = defineQuery<BabysitStatus>(BABYSIT_STATUS_QUERY);

function statusComment(line: string): string {
  return `**PR babysitter** — ${line}`;
}

export async function prBabysitWorkflow(
  input: PrBabysitWorkflowInput,
): Promise<void> {
  // Mutable signal state lives in an object so TS does not narrow these
  // closure-mutated values to literals (a `let stopped = false` mutated only in
  // a signal handler reads as always-false in `if (stopped)`; an object property
  // reads as its declared type). Same reason `reconcileLock` uses a counter.
  const sig: {
    events: number;
    stopped: boolean;
    stopReason: string;
    guidanceSeq: number;
    guidanceText: string | undefined;
  } = {
    events: 0,
    stopped: false,
    stopReason: "",
    guidanceSeq: 0,
    guidanceText: undefined,
  };
  const view: {
    phase: BabysitPhase;
    iterationsTotal: number;
    costUsd: number;
    lastVerdict: BabysitVerdict | undefined;
    awaitingGuidanceQuestion: string | undefined;
  } = {
    phase: "assessing",
    iterationsTotal: input.resume?.iterationsTotal ?? 0,
    costUsd: input.resume?.costUsd ?? 0,
    lastVerdict: undefined,
    awaitingGuidanceQuestion: undefined,
  };
  const recentSignatures: string[] = [
    ...(input.resume?.recentSignatures ?? []),
  ];
  const startedAtEpochMs = input.resume?.startedAtEpochMs ?? Date.now();

  const bump = (): void => {
    sig.events += 1;
  };
  setHandler(ciCompletedSignal, bump);
  setHandler(branchPushedSignal, bump);
  setHandler(reviewActivitySignal, bump);
  setHandler(mainAdvancedSignal, bump);
  setHandler(guidanceSignal, (payload) => {
    sig.guidanceText = payload.text;
    sig.guidanceSeq += 1;
    sig.events += 1;
  });
  setHandler(stopSignal, (payload) => {
    sig.stopped = true;
    sig.stopReason = payload.reason;
    sig.events += 1;
  });
  setHandler(statusQuery, () => ({
    phase: view.phase,
    iterationsTotal: view.iterationsTotal,
    costUsd: view.costUsd,
    ...(view.lastVerdict === undefined
      ? {}
      : { lastVerdict: view.lastVerdict }),
    ...(view.awaitingGuidanceQuestion === undefined
      ? {}
      : { awaitingGuidanceQuestion: view.awaitingGuidanceQuestion }),
  }));

  const { owner, repo, prNumber, headRef, baseRef } = input;
  const workflowId = workflowInfo().workflowId;

  const fast = proxyActivities<PrBabysitActivities>({
    startToCloseTimeout: "5 minutes",
    retry: { maximumAttempts: 4, initialInterval: "5 seconds" },
  });
  const iteration = proxyActivities<PrBabysitActivities>({
    startToCloseTimeout: input.budget.perIterationTimeoutMinutes * 60_000,
    heartbeatTimeout: "60 seconds",
    retry: { maximumAttempts: 1 },
  });

  const post = async (body: string): Promise<void> => {
    await fast.postBabysitStatus({ owner, repo, prNumber, body });
  };
  const standDown = async (reason: string): Promise<void> => {
    view.phase = "standing-down";
    await post(
      statusComment(
        `standing down: ${reason} — iterations=${String(view.iterationsTotal)}, cost=$${view.costUsd.toFixed(2)}.`,
      ),
    );
    await fast.cleanupBabysitWorkdir({ workflowId });
  };
  // Sleep up to `timeoutMs`, waking early on any signal (including stop).
  const waitForEvents = async (timeoutMs: number): Promise<void> => {
    const seen = sig.events;
    await condition(() => sig.events !== seen || sig.stopped, timeoutMs);
  };

  // Run one fix→(guidance|push)→await-CI cycle. Returns "stop" if it stood down
  // (guidance timeout / stop) so the caller can exit; "continue" otherwise.
  const runActPhase = async (
    workdir: string,
    verdict: BabysitVerdict,
  ): Promise<"continue" | "stop"> => {
    view.phase = "fixing";
    recentSignatures.push(failureSignature(verdict));
    const { result, cost } = await iteration.runBabysitIteration({
      input,
      verdict,
      workdir,
      ...(sig.guidanceText === undefined ? {} : { guidance: sig.guidanceText }),
    });
    sig.guidanceText = undefined;
    view.iterationsTotal += 1;
    view.costUsd += cost.costUsd ?? 0;

    if (result.needsGuidance || result.intentConflict) {
      view.phase = "awaiting-guidance";
      view.awaitingGuidanceQuestion =
        result.guidanceQuestion ?? result.escalationReason ?? "needs guidance";
      await post(
        statusComment(
          `⚠️ needs your guidance: ${view.awaitingGuidanceQuestion}\n\nReply here to steer, or comment \`@temporal-worker stop\`.`,
        ),
      );
      const before = sig.guidanceSeq;
      const got = await condition(
        () => sig.guidanceSeq !== before || sig.stopped,
        GUIDANCE_TIMEOUT_MS,
      );
      view.awaitingGuidanceQuestion = undefined;
      if (!got || sig.stopped) {
        await standDown(
          sig.stopped ? `stopped (${sig.stopReason})` : "guidance timeout",
        );
        return "stop";
      }
      return "continue";
    }

    if (result.committed) {
      view.phase = "pushing";
      await fast.pushBabysitBranch({ workdir, headRef });
    }
    view.phase = "awaiting-ci";
    await waitForEvents(ACTIVE_POLL_MS);
    return "continue";
  };

  let iterThisRun = 0;
  for (;;) {
    if (sig.stopped) {
      await standDown(`stopped (${sig.stopReason})`);
      return;
    }
    if (iterThisRun >= ITERATIONS_PER_RUN) {
      await continueAsNew<typeof prBabysitWorkflow>({
        ...input,
        resume: {
          iterationsTotal: view.iterationsTotal,
          costUsd: view.costUsd,
          recentSignatures,
          startedAtEpochMs,
        },
      });
    }

    view.phase = "assessing";
    // Refresh the workdir to origin/<headRef> at the start of every iteration so
    // a prior remote-moved push is reconciled and we never assess stale state.
    const { workdir } = await fast.prepareBabysitWorkdir({
      owner,
      repo,
      headRef,
      baseRef,
      workflowId,
    });
    const verdict = await fast.evaluateBabysitDoD({
      owner,
      repo,
      prNumber,
      baseRef,
      workdir,
      blockingSeverity: input.blockingSeverity,
    });
    view.lastVerdict = verdict;

    const decision = decideNextAction(verdict, input.budget, {
      iterationsTotal: view.iterationsTotal,
      costUsd: view.costUsd,
      elapsedMinutes: (Date.now() - startedAtEpochMs) / 60_000,
      recentSignatures,
    });

    if (decision.kind === "closed") {
      view.phase = "done";
      await fast.cleanupBabysitWorkdir({ workflowId });
      return;
    }
    if (decision.kind === "standdown") {
      await standDown(decision.reason ?? "budget exhausted");
      return;
    }
    if (decision.kind === "done") {
      view.phase = "light-monitor";
      await post(
        statusComment(
          "✅ ready to merge — CI green, no conflicts, no unresolved P3+ comments. Monitoring.",
        ),
      );
      await waitForEvents(LIGHT_MONITOR_MS);
      continue;
    }
    if (decision.kind === "wait") {
      view.phase = "awaiting-ci";
      await waitForEvents(ACTIVE_POLL_MS);
      continue;
    }

    // decision.kind === "act"
    iterThisRun += 1;
    if ((await runActPhase(workdir, verdict)) === "stop") {
      return;
    }
  }
}
