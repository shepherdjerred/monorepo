import type {
  DiscordAccountId,
  DiscordChannelId,
  ExploreAnswer,
  ExploreMatchCard,
  ExploreMessage,
  ExploreStreamEvent,
  ExploreTraceEntry,
  ReportAiPreviewSummary,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  buildMessages,
  type ExploreModelMessage,
  type streamExploreAgent,
} from "#src/explore/agent.ts";
import {
  finalizeExploreTrace,
  recordExploreTraceEvent,
} from "#src/explore/trace.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
import type { ExploreCapabilitySet } from "#src/explore/replay/profiles.ts";

/**
 * Running one replay case against the real Explore agent.
 *
 * Deliberately calls `streamExploreAgent` rather than the persisted turn above
 * it. `run-turn.ts` appends the answer to the conversation and moves its leaf;
 * replaying through it would write into the very conversation being replayed,
 * so turn N's "original history" would start containing replayed answers and
 * the corpus would rot a little with every run. Nothing here persists
 * anything — a replay reads the snapshot and writes only its bundle.
 */

export type ReplayCaseInput = {
  readonly caseId: string;
  readonly kind: "chip" | "conversation";
  readonly conversationId: string;
  readonly question: string;
  /**
   * The ORIGINAL prior turns, verbatim.
   *
   * Pinned history is the whole point: each turn is answered against what the
   * real user actually saw, so a difference is attributable to that turn
   * rather than to a divergence three turns earlier.
   */
  readonly history: readonly ExploreMessage[];
  readonly requesterId: DiscordAccountId;
  readonly guildIds: readonly string[];
  readonly surface: ExploreSurface;
  readonly originChannelId: DiscordChannelId | null;
};

export type ReplayObservation = {
  readonly caseId: string;
  readonly status: "ok" | "error" | "timeout";
  readonly durationMs: number;
  readonly answer: ExploreAnswer | null;
  readonly preview: ReportAiPreviewSummary | null;
  readonly visualization: VisualizationSnapshot | null;
  readonly matchCards: readonly ExploreMatchCard[];
  /** Folded through the same helper the product uses, so it diffs against stored traces. */
  readonly trace: readonly ExploreTraceEntry[];
  /** Exactly what the model was given, not a reconstruction of it. */
  readonly modelMessages: readonly ExploreModelMessage[];
  /** What the turn actually resolved, for the profile assertion. */
  readonly capabilities: ExploreCapabilitySet;
  readonly error: string | null;
};

export type ReplayRunnerDependencies = {
  readonly executeAgent: typeof streamExploreAgent;
  /**
   * The capabilities this turn will resolve.
   *
   * Re-resolved through the *same* functions the agent calls rather than
   * reimplemented, and deterministic here because the harness pins flags
   * statically. It is a second call, not a second rule.
   */
  readonly resolveCapabilities: (input: {
    readonly guildIds: readonly string[];
    readonly surface: ExploreSurface;
  }) => Promise<ExploreCapabilitySet>;
  readonly now: () => number;
  readonly timeoutMs: number;
  readonly newRunId: () => string;
};

function agentParams(
  input: ReplayCaseInput,
  runId: string,
  abortSignal: AbortSignal,
  emit: (event: ExploreStreamEvent) => void,
): Parameters<typeof streamExploreAgent>[0] {
  return {
    runId,
    conversationId: input.conversationId,
    subject: { kind: "discord_user", id: input.requesterId },
    question: input.question,
    history: [...input.history],
    guildIds: [...input.guildIds],
    requesterId: input.requesterId,
    originChannelId: input.originChannelId,
    surface: input.surface,
    abortSignal,
    emit,
  };
}

export async function runReplayCase(
  input: ReplayCaseInput,
  dependencies: ReplayRunnerDependencies,
): Promise<ReplayObservation> {
  const startedAt = dependencies.now();
  const capabilities = await dependencies.resolveCapabilities({
    guildIds: input.guildIds,
    surface: input.surface,
  });

  const trace: ExploreTraceEntry[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, dependencies.timeoutMs);
  const runId = dependencies.newRunId();
  const params = agentParams(input, runId, controller.signal, (event) => {
    recordExploreTraceEvent(trace, event);
  });

  // Recorded before the call so a turn that throws still shows what it was
  // asked. A failed case with no visible prompt is the least useful row in a
  // bundle.
  const modelMessages = buildMessages(params);

  try {
    const result = await dependencies.executeAgent(params);
    return {
      caseId: input.caseId,
      status: "ok",
      durationMs: dependencies.now() - startedAt,
      answer: result.answer,
      preview: result.preview,
      visualization: result.visualization,
      matchCards: result.matchCards,
      // A tool call with no terminal part means the step never finished;
      // leaving it "running" in a bundle would read as a tool that is still
      // going, hours after the run ended.
      trace: finalizeExploreTrace(trace),
      modelMessages,
      capabilities,
      error: null,
    };
  } catch (error) {
    // A timeout and a failure read very differently in a summary: one says the
    // question was too slow, the other that the turn broke. The abort signal
    // is the only thing that can tell them apart after the fact.
    const status = controller.signal.aborted ? "timeout" : "error";
    return {
      caseId: input.caseId,
      status,
      durationMs: dependencies.now() - startedAt,
      answer: null,
      preview: null,
      visualization: null,
      matchCards: [],
      trace: finalizeExploreTrace(trace),
      modelMessages,
      capabilities,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run cases with bounded concurrency, preserving input order in the output.
 *
 * Order is not cosmetic: a bundle whose case order depended on which turns
 * happened to finish first could not be diffed against another run of the same
 * corpus without sorting it first.
 */
export async function runReplayCases(
  cases: readonly ReplayCaseInput[],
  dependencies: ReplayRunnerDependencies,
  options: {
    readonly concurrency: number;
    readonly onComplete?: (observation: ReplayObservation) => Promise<void>;
  },
): Promise<readonly ReplayObservation[]> {
  const results: (ReplayObservation | undefined)[] = Array.from({
    length: cases.length,
  });
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      const entry = cases[index];
      if (entry === undefined) return;
      const observation = await runReplayCase(entry, dependencies);
      results[index] = observation;
      // Awaited rather than fired off: this is what appends the resume index,
      // and a run killed between the model call and the append must re-run the
      // case rather than skip it.
      await options.onComplete?.(observation);
    }
  }

  const workerCount = Math.max(1, Math.min(options.concurrency, cases.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results.map((observation, index) => {
    if (observation === undefined) {
      throw new Error(
        `Replay case at index ${index.toString()} produced no observation.`,
      );
    }
    return observation;
  });
}
