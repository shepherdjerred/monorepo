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
/**
 * Consecutive assess/act activity failures (e.g. a worker restart wiping the
 * workdir mid-run) before the loop stands down instead of retrying forever.
 */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Backoff after a caught transient failure before re-assessing. */
const FAILURE_BACKOFF_MS = 30 * 1000;

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

/** Short, single-line rendering of a caught activity error for a status comment. */
function errText(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
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
  // Consecutive assess/act activity failures; bounds stand-down after a run of
  // infra errors (e.g. worker restarts wiping the workdir). Reset on any healthy
  // pass. Carried across continueAsNew so a redeploy on the loop boundary can't
  // silently reset the bound.
  let consecutiveFailures = input.resume?.consecutiveFailures ?? 0;

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
  // `assessBabysit` bundles a possible cold blobless clone with the DoD
  // evaluation, so it gets a longer window than the other fast activities. Its
  // retries now genuinely recover from a wiped workdir because the ensure is
  // inside the activity.
  const assess = proxyActivities<PrBabysitActivities>({
    startToCloseTimeout: "10 minutes",
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
    verdict: BabysitVerdict,
  ): Promise<"continue" | "stop"> => {
    view.phase = "fixing";
    recentSignatures.push(failureSignature(verdict));
    // The iteration activity re-ensures the workdir from origin, runs the agent,
    // and pushes any commit itself — so the pushed commit on origin is the only
    // durable handoff and nothing depends on this pod's local /tmp surviving.
    const { result, cost } = await iteration.runBabysitIteration({
      input,
      verdict,
      workflowId,
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

    view.phase = "awaiting-ci";
    await waitForEvents(ACTIVE_POLL_MS);
    return "continue";
  };

  if (input.resume === undefined) {
    // Immediate ack so a triggering user sees the babysitter engaged, and so an
    // early failure is visible instead of silent. Updated in place via the
    // single status marker as the loop progresses.
    await post(statusComment("🔧 on it — assessing the PR…"));
  }

  // A workdir-consuming activity threw (e.g. a worker restart wiped the workdir
  // mid-run). Bump the consecutive-failure counter and either stand down (bound
  // reached) or post a transient notice + back off, then re-assess from origin.
  // Returns true if it stood down and the loop should exit.
  const onActivityFailure = async (
    what: string,
    error: unknown,
  ): Promise<boolean> => {
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await standDown(
        `repeated errors ${what} (${String(consecutiveFailures)}×): ${errText(error)}`,
      );
      return true;
    }
    await post(
      statusComment(
        `⚠️ transient error ${what} (attempt ${String(consecutiveFailures)}/${String(MAX_CONSECUTIVE_FAILURES)}) — re-assessing shortly.`,
      ),
    );
    await waitForEvents(FAILURE_BACKOFF_MS);
    return false;
  };

  // Act on a DoD decision. Returns "stop" when the loop should exit (PR
  // closed/merged, budget stand-down, or a failure bound reached), "continue"
  // otherwise. Extracted to keep the top-level loop within complexity limits.
  const handleDecision = async (
    decision: ReturnType<typeof decideNextAction>,
    verdict: BabysitVerdict,
  ): Promise<"continue" | "stop"> => {
    if (decision.kind === "closed") {
      view.phase = "done";
      await fast.cleanupBabysitWorkdir({ workflowId });
      return "stop";
    }
    if (decision.kind === "standdown") {
      await standDown(decision.reason ?? "budget exhausted");
      return "stop";
    }
    if (decision.kind === "done") {
      consecutiveFailures = 0;
      view.phase = "light-monitor";
      await post(
        statusComment(
          "✅ ready to merge — CI green, no conflicts, no unresolved P3+ comments. Monitoring.",
        ),
      );
      await waitForEvents(LIGHT_MONITOR_MS);
      return "continue";
    }
    if (decision.kind === "wait") {
      consecutiveFailures = 0;
      view.phase = "awaiting-ci";
      await waitForEvents(ACTIVE_POLL_MS);
      return "continue";
    }
    // decision.kind === "act"
    iterThisRun += 1;
    try {
      if ((await runActPhase(verdict)) === "stop") return "stop";
    } catch (error) {
      return (await onActivityFailure("running the fix iteration", error))
        ? "stop"
        : "continue";
    }
    consecutiveFailures = 0;
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
          consecutiveFailures,
        },
      });
    }

    view.phase = "assessing";
    // assessBabysit re-ensures the workdir from origin, then evaluates the DoD.
    // Because the ensure is inside the activity, a retry on a fresh pod re-clones
    // instead of crashing on a workdir a restart wiped — so nothing here depends
    // on a sibling activity having left files on this pod's local /tmp.
    let verdict: BabysitVerdict;
    try {
      verdict = await assess.assessBabysit({
        owner,
        repo,
        prNumber,
        headRef,
        baseRef,
        workflowId,
        blockingSeverity: input.blockingSeverity,
      });
    } catch (error) {
      if (await onActivityFailure("assessing the PR", error)) return;
      continue;
    }
    view.lastVerdict = verdict;

    const decision = decideNextAction(verdict, input.budget, {
      iterationsTotal: view.iterationsTotal,
      costUsd: view.costUsd,
      elapsedMinutes: (Date.now() - startedAtEpochMs) / 60_000,
      recentSignatures,
    });

    if ((await handleDecision(decision, verdict)) === "stop") return;
  }
}
