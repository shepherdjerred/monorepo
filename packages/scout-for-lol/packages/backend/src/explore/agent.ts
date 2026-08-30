import { Output, stepCountIs, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import {
  EXPLORE_MAX_HISTORY_TURNS,
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_PREVIEW_CALLS,
  EXPLORE_MAX_STEPS,
  EXPLORE_MAX_TOOL_CALLS,
  ExploreAnswerSchema,
  ExploreAnswerWireSchema,
  modelSupportsParameter,
  ReportAiModelPreviewSummarySchema,
  ReportQueryTextSchema,
  type ExploreAnswer,
  type ExploreMessage,
  type ExploreStreamEvent,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { quoteScoutQlString } from "@scout-for-lol/data/model/scoutql/format-expr.ts";
import { exploreModel } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { getOpenRouterRuntime } from "#src/league/review/ai-clients.ts";
import { createLogger } from "#src/logger.ts";
import { drainExploreStreams } from "#src/explore/stream.ts";
import {
  assertWithinBudget,
  recordTokenUsage,
} from "#src/league/review/openai-budget.ts";
import {
  scoutExploreTokensUsedTotal,
  scoutExploreToolCallsTotal,
} from "#src/metrics/explore.ts";
import {
  createFormatTool,
  createLanguageTool,
  createValidateTool,
  QueryResultToolOutputSchema,
  validateQuery,
  type ToolTracker,
} from "#src/reports/ai/scoutql-tools.ts";
import { reportQueryPreviewSummary } from "#src/reports/ai/report-query-preview-summary.ts";
import { GLOBAL_SCOPE } from "#src/reports/duckdb/scope.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import { resolvePlayerIdentities } from "#src/reports/identity.ts";
import {
  withLlmSubjectSpan,
  type LlmSubject,
} from "@shepherdjerred/llm-observability/subject";

const logger = createLogger("explore-agent");

export type ExploreAgentParams = {
  runId: string;
  /**
   * Who this turn is being answered for. Required rather than optional: an
   * Explore turn always has an asker, and an optional field would quietly
   * produce unattributed spend the first time a caller forgot it.
   */
  subject: LlmSubject;
  question: string;
  /** Prior turns of this conversation, oldest first. */
  history: ExploreMessage[];
  /**
   * The asker's Discord servers, used only to resolve a `player('…')` alias.
   * Explore is global otherwise; this is the one lookup that reads per-server
   * data, so it stays bounded to servers this person belongs to.
   */
  guildIds: string[];
  abortSignal: AbortSignal;
  emit: (event: ExploreStreamEvent) => void | Promise<void>;
};

export type ExploreAgentResult = {
  answer: ExploreAnswer;
  /** The result of the last successful query, kept for the transcript. */
  preview: ReportAiPreviewSummary | null;
  visualization: VisualizationSnapshot | null;
};

type RunState = {
  toolCalls: number;
  previewCalls: number;
  /** Result of the most recent successful query, attached to the answer. */
  lastPreview: ReportAiPreviewSummary | null;
  lastVisualization: VisualizationSnapshot | null;
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
  const runtime = getOpenRouterRuntime();
  if (runtime === undefined) {
    throw new Error("OPENROUTER_API_KEY is required for explore");
  }
  assertWithinBudget();

  const state: RunState = {
    toolCalls: 0,
    previewCalls: 0,
    lastPreview: null,
    lastVisualization: null,
  };

  const agent = new ToolLoopAgent({
    id: "scout-explore-agent",
    instructions: exploreAgentInstructions(),
    model: runtime.languageModel(model, ["tools"]),
    tools: createExploreTools(params, state),
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
    preview: state.lastPreview,
    visualization: state.lastVisualization,
  };
}

type ExploreModelMessage =
  { role: "user"; content: string } | { role: "assistant"; content: string };

/**
 * Rebuild the conversation as model messages.
 *
 * History comes from the database, never from the client, so a caller cannot
 * forge prior turns to steer an answer. Assistant turns replay only the prose
 * and the query that produced it — not the full row set, which would blow up
 * the context for questions that no longer depend on it.
 */
function buildMessages(params: ExploreAgentParams): ExploreModelMessage[] {
  const recent = params.history.slice(-EXPLORE_MAX_HISTORY_TURNS * 2);
  const messages = recent.map((message): ExploreModelMessage =>
    message.role === "assistant"
      ? {
          role: "assistant",
          content:
            message.queryText === null
              ? message.content
              : `${message.content}\n\n[ScoutQL used]\n${message.queryText}`,
        }
      : { role: "user", content: message.content },
  );
  return [...messages, { role: "user", content: params.question }];
}

function createExploreTools(params: ExploreAgentParams, state: RunState) {
  const track: ToolTracker = async (toolName, work) => {
    state.toolCalls++;
    if (state.toolCalls > EXPLORE_MAX_TOOL_CALLS) {
      scoutExploreToolCallsTotal.inc({
        tool_name: toolName,
        status: "limited",
      });
      throw new Error("This question used too many steps. Try a simpler one.");
    }
    try {
      const result = await work();
      scoutExploreToolCallsTotal.inc({
        tool_name: toolName,
        status: "success",
      });
      return result;
    } catch (error) {
      scoutExploreToolCallsTotal.inc({ tool_name: toolName, status: "error" });
      throw error;
    }
  };

  /**
   * Who a name means, before a query is spent on it.
   *
   * `player('…')` resolves the same way at execution, so this is not required
   * for correctness — it exists so the agent can disambiguate a name that
   * matches two people, and can tell the reader which accounts an answer
   * folded together. Its output deliberately carries PUUIDs for the model's
   * own reasoning only; they never reach query text, which is what the
   * `player('…')` call form is for.
   */
  const resolvePlayer = tool({
    description:
      "Find out who a name refers to before querying: accepts a Scout alias, a Riot ID, or a game name, and returns each matching person with every account and past Riot ID they have used. Use the returned displayName inside player('…').",
    inputSchema: z.object({ query: z.string().min(1).max(100) }).strict(),
    outputSchema: z
      .object({
        candidates: z.array(
          z.object({
            displayName: z.string(),
            riotIds: z.array(z.string()),
            accounts: z.number(),
            games: z.number(),
            firstSeen: z.string(),
            lastSeen: z.string(),
            matchedBy: z.enum(["alias", "riot_id"]),
          }),
        ),
        message: z.string(),
      })
      .strict(),
    execute: (inputData) =>
      track("resolve_player", async () => {
        const found = await resolvePlayerIdentities({
          query: inputData.query,
          guildIds: params.guildIds,
        });
        return {
          candidates: found.map((identity) => ({
            displayName: identity.displayName,
            riotIds: identity.riotIds,
            accounts: identity.puuids.length,
            games: identity.games,
            firstSeen: identity.firstSeen,
            lastSeen: identity.lastSeen,
            matchedBy: identity.matchedBy,
          })),
          message:
            found.length === 0
              ? `No player matches "${inputData.query}". Say the data does not cover them rather than guessing at a similar name.`
              : found.length === 1
                ? `One match. Use player(${quoteScoutQlString(found[0]?.displayName ?? inputData.query)}) in the query.`
                : `${found.length.toString()} people match. Ask which one they meant before querying.`,
        };
      }),
  });

  const runReportQuery = tool({
    description:
      "Run a valid ScoutQL query against all ingested match data and return the resulting rows. Every statistic you state must come from a result of this tool.",
    inputSchema: z.object({ queryText: ReportQueryTextSchema }).strict(),
    outputSchema: QueryResultToolOutputSchema,
    execute: (inputData) =>
      track("run_report_query", async () => {
        state.previewCalls++;
        if (state.previewCalls > EXPLORE_MAX_PREVIEW_CALLS) {
          throw new Error("This question ran too many queries.");
        }
        const validation = validateQuery(inputData.queryText);
        if (!validation.ok || validation.formattedQueryText === null) {
          return {
            ok: false,
            message: validation.message,
            formattedQueryText: null,
            preview: null,
          };
        }

        const result = await executeReportQuery({
          prisma,
          scope: GLOBAL_SCOPE,
          askerGuildIds: params.guildIds,
          queryText: validation.formattedQueryText,
        });
        const preview = reportQueryPreviewSummary(result);
        const modelPreview = ReportAiModelPreviewSummarySchema.parse(preview);
        state.lastPreview = preview;
        state.lastVisualization = result.visualization ?? null;

        await params.emit({
          type: "preview",
          preview,
          visualization: result.visualization ?? null,
        });
        return {
          ok: true,
          message:
            preview.rowsReturned === 0
              ? `No rows matched after scanning ${preview.rowsScanned.toString()} rows. The data does not cover this — say so rather than estimating.`
              : `Returned ${preview.rowsReturned.toString()} rows after scanning ${preview.rowsScanned.toString()} rows.`,
          formattedQueryText: validation.formattedQueryText,
          preview: modelPreview,
        };
      }),
  });

  return {
    get_report_language: createLanguageTool(track),
    resolve_player: resolvePlayer,
    validate_report_query: createValidateTool(track),
    run_report_query: runReportQuery,
    format_report_query: createFormatTool(track),
  };
}
