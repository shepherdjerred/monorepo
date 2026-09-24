import { Output, stepCountIs, ToolLoopAgent } from "ai";
import {
  EXPLORE_MAX_HISTORY_TURNS,
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_STEPS,
  ExploreAnswerSchema,
  ExploreAnswerWireSchema,
  modelSupportsParameter,
  type ExploreAnswer,
  type ExploreMatchCard,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { withLlmSubjectSpan } from "@shepherdjerred/llm-observability/subject";
import { exploreModel } from "#src/config/dynamic.ts";
import {
  createExploreTools,
  type ExploreAgentParams,
  type RunState,
} from "#src/explore/agent-tools.ts";
import { resolveCreationCapability } from "#src/explore/creation/capability.ts";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { drainExploreStreams } from "#src/explore/stream.ts";
import { challengeExploreEnabled } from "#src/explore/tools/challenge-tools.ts";
import { dareExploreEnabled } from "#src/explore/tools/dare-tool-context.ts";
import { resolveBucksCapability } from "#src/explore/tools/bucks-tools.ts";
import { resolveMvpVotesCapability } from "#src/explore/tools/mvp-votes-tools.ts";
import { riotHistoryExploreEnabled } from "#src/explore/tools/riot-history-tools.ts";
import { hydrateExploreMatchCards } from "#src/explore-match/match-view.ts";
import { clashExploreEnabled } from "#src/league/clash/access.ts";
import { resolveHallCapability } from "#src/explore/tools/hall-tools.ts";
import { getLlmRuntime } from "#src/league/review/ai-clients.ts";
import {
  assertWithinBudget,
  recordTokenUsage,
} from "#src/league/review/openai-budget.ts";
import { createLogger } from "#src/logger.ts";
import { scoutExploreTokensUsedTotal } from "#src/metrics/explore.ts";

const logger = createLogger("explore-agent");

export type ExploreAgentResult = {
  answer: ExploreAnswer;
  /** The result of the last successful query, kept for the transcript. */
  preview: ReportAiPreviewSummary | null;
  visualization: VisualizationSnapshot | null;
  /** Frozen, source-backed artifacts requested by the model. */
  matchCards: ExploreMatchCard[];
};

export async function streamExploreAgent(
  params: ExploreAgentParams,
): Promise<ExploreAgentResult> {
  // Wraps the whole turn so the nested report-query agent, which opens no span
  // of its own, is attributed to the same asker as its parent explore turn.
  return await withLlmSubjectSpan("scout.explore", params.subject, () =>
    streamExploreAgentInternal(params),
  );
}

async function streamExploreAgentInternal(
  params: ExploreAgentParams,
): Promise<ExploreAgentResult> {
  const model = exploreModel();
  const runtime = getLlmRuntime();
  if (runtime === undefined) {
    throw new Error("OPENROUTER_API_KEY is required for explore");
  }
  assertWithinBudget();

  const state: RunState = {
    toolCalls: 0,
    previewCalls: 0,
    lastPreview: null,
    lastVisualization: null,
    lastMatchIds: new Set(),
    lastQueryMatchIds: new Set(),
    loadedSkills: new Set(),
  };

  // Derived per turn rather than persisted, so Temporal recovery and flag
  // revocation both re-evaluate; a guild losing `betting_enabled` loses the
  // tools on its very next turn.
  const bucksCapability = await resolveBucksCapability(params.guildIds);
  const mvpVotesCapability = await resolveMvpVotesCapability(params.guildIds);
  const daresEnabled = await dareExploreEnabled(bucksCapability);
  const challengesEnabled = await challengeExploreEnabled(params.guildIds);
  // Tier 1 only: a surface comparison and one flag read per guild. The
  // permission work this gates is deferred into the first creation tool call,
  // so an analytics turn never pays for an OAuth refresh it will not use.
  const creationCapability = await resolveCreationCapability({
    surface: params.surface,
    guildIds: params.guildIds,
  });
  const riotHistoryEnabled = await riotHistoryExploreEnabled(params.guildIds);
  const clashEnabled = await clashExploreEnabled(params.guildIds);
  const hallCapability = await resolveHallCapability(params.guildIds);

  const clock = { currentTime: new Date().toISOString() };
  const skillOptions = {
    bucks: bucksCapability === null ? null : clock,
    mvpVotes: mvpVotesCapability === null ? null : clock,
    dares: daresEnabled,
    challenges: challengesEnabled,
    creation: creationCapability !== null,
    riotHistory: riotHistoryEnabled,
    clash: clashEnabled,
    hallOfFame: hallCapability !== null,
    surface: params.surface,
  };

  const agent = new ToolLoopAgent({
    id: "scout-explore-agent",
    instructions: exploreAgentInstructions(skillOptions),
    model: runtime.languageModel(model, ["tools"]),
    tools: createExploreTools({
      params,
      state,
      skillOptions,
      bucksCapability,
      mvpVotesCapability,
      daresEnabled,
      challengesEnabled,
      creationCapability,
      riotHistoryEnabled,
      clashEnabled,
      hallCapability,
    }),
    stopWhen: stepCountIs(EXPLORE_MAX_STEPS),
    // Most current models (every GPT-5.x, most Claude) declare
    // supportsTemperature: false, and the runtime asks OpenRouter for
    // `require_parameters` whenever a call needs tools or structured output.
    // Sending temperature to a model that does not accept it therefore leaves
    // zero eligible endpoints and the whole turn fails with a 404 "No endpoints
    // found that can handle the requested parameters" — not a soft downgrade.
    ...(modelSupportsParameter(model, "temperature")
      ? { temperature: 0.2 }
      : {}),
    maxOutputTokens: EXPLORE_MAX_OUTPUT_TOKENS,
    output: Output.object({ schema: ExploreAnswerWireSchema }),
    ...runtime.callOptions({
      workload: "scout.explore",
      sessionId: params.runId,
      // One cache partition for every turn. The per-turn session id would
      // otherwise partition it, and no turn could reuse another's cached
      // prompt — which is most of what a turn sends.
      promptCacheKey: "scout.explore",
    }),
  });

  const stream = await agent.stream({
    messages: buildMessages(params),
    abortSignal: params.abortSignal,
  });

  // The AI SDK splits what Mastra multiplexed: tool and step parts arrive on
  // `stream`, while progressively-parsed structured output arrives on
  // `partialOutputStream`. The prose the page renders comes from the latter —
  // a `text-delta` part is raw JSON here. Both views must be drained together;
  // drainExploreStreams owns that invariant and its regression test.
  const streamState = await drainExploreStreams(stream, params.emit);

  const answer = ExploreAnswerSchema.parse(await stream.output);
  if (
    params.surface === "voice" &&
    (answer.spokenAnswer === null || answer.spokenAnswer === undefined)
  ) {
    throw new Error("Voice Explore answers require spokenAnswer");
  }
  const matchCards =
    params.surface === "web" || params.surface === "voice"
      ? await hydrateExploreMatchCards({
          requests: answer.matchCards,
          eligibleMatchIds: state.lastMatchIds,
        })
      : [];

  // Streaming depends on the model emitting `answer` early enough for the
  // partial snapshots to carry it. If that ever stops holding — a reordered
  // schema, a provider that buffers — the turn still succeeds and the answer
  // simply appears all at once, which is invisible in tests and in prod.
  // Say so out loud rather than letting the page quietly stop streaming.
  if (streamState.sentAnswerLength === 0 && answer.answer.length > 0) {
    logger.warn(
      "Explore answer never streamed: no partial snapshot carried `answer`.",
      { model, answerLength: answer.answer.length },
    );
  }

  const usage = await stream.usage;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  scoutExploreTokensUsedTotal.inc({ model, kind: "prompt" }, inputTokens);
  scoutExploreTokensUsedTotal.inc({ model, kind: "completion" }, outputTokens);
  recordTokenUsage(inputTokens, outputTokens, model);

  return {
    answer,
    preview: answer.includeVisualization ? state.lastPreview : null,
    visualization: answer.includeVisualization ? state.lastVisualization : null,
    matchCards,
  };
}

export type ExploreModelMessage =
  { role: "user"; content: string } | { role: "assistant"; content: string };

type MatchCardReplayContext = {
  size: string;
  match: {
    matchId: string;
    teams: readonly { teamId: number; win: boolean; kills: number }[];
  };
};

/** Preserve the visible card order so follow-ups can refer to “the first card”. */
export function matchCardReplayContext(
  cards: readonly MatchCardReplayContext[],
): string {
  if (cards.length === 0) return "";
  const entries = cards.map((card, index) => {
    const teams = card.match.teams
      .map(
        (team) =>
          `Team ${team.teamId.toString()} ${team.win ? "won" : "lost"} (${team.kills.toString()} kills)`,
      )
      .join("; ");
    return `Card ${String(index + 1)} (${card.size}): ${card.match.matchId}; ${teams}.`;
  });
  return `\n\n[Match cards shown in order]\n${entries.join("\n")}`;
}

/**
 * Rebuild the conversation as model messages.
 *
 * History comes from the database, never from the client, so a caller cannot
 * forge prior turns to steer an answer. Assistant turns replay their prose,
 * query, and compact card identities — not the full row set, which would blow
 * up context for questions that no longer depend on it.
 *
 * Exported so the Explore replay eval can record what the model was actually
 * given, rather than a reconstruction of it. A bundle that shows an
 * approximation of the prompt cannot answer "why did this turn differ", which
 * is the only question it exists to answer.
 */
export function buildMessages(
  params: ExploreAgentParams,
): ExploreModelMessage[] {
  const recent = params.history.slice(-EXPLORE_MAX_HISTORY_TURNS * 2);
  const messages = recent.map((message): ExploreModelMessage =>
    message.role === "assistant"
      ? {
          role: "assistant",
          content:
            message.queryText === null
              ? `${message.content}${matchCardReplayContext(message.matchCards)}`
              : `${message.content}\n\n[ScoutQL used]\n${message.queryText}${matchCardReplayContext(message.matchCards)}`,
        }
      : { role: "user", content: message.content },
  );
  return [...messages, { role: "user", content: params.question }];
}
