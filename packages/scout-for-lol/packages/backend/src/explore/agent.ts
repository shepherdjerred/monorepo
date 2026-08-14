import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  EXPLORE_MAX_HISTORY_TURNS,
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_PREVIEW_CALLS,
  EXPLORE_MAX_STEPS,
  EXPLORE_MAX_TOOL_CALLS,
  ExploreAnswerSchema,
  ReportQueryTextSchema,
  type ExploreAnswer,
  type ExploreMessage,
  type ExploreStreamEvent,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { emitExploreStreamChunk } from "#src/explore/stream.ts";
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

export type ExploreAgentParams = {
  runId: string;
  question: string;
  /** Prior turns of this conversation, oldest first. */
  history: ExploreMessage[];
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
  const model = configuration.exploreModel;
  if (model.startsWith("openai/")) {
    assertWithinBudget();
  }

  const state: RunState = {
    toolCalls: 0,
    previewCalls: 0,
    lastPreview: null,
    lastVisualization: null,
  };

  const agent = new Agent({
    id: "scout-explore-agent",
    name: "Scout explore agent",
    instructions: exploreAgentInstructions(),
    model,
    tools: createExploreTools(params, state),
  });

  const stream = await agent.stream(buildMessages(params), {
    runId: params.runId,
    maxSteps: EXPLORE_MAX_STEPS,
    toolChoice: "auto",
    abortSignal: params.abortSignal,
    modelSettings: {
      temperature: 0.2,
      maxOutputTokens: EXPLORE_MAX_OUTPUT_TOKENS,
    },
    structuredOutput: {
      schema: ExploreAnswerSchema,
      jsonPromptInjection: true,
    },
  });

  const reader = stream.fullStream.getReader();
  try {
    let read = await reader.read();
    while (!read.done) {
      await emitExploreStreamChunk(read.value, params.emit);
      read = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  const output = await stream.getFullOutput();
  if (output.error !== undefined) {
    throw output.error;
  }

  const answer = ExploreAnswerSchema.parse(output.object);

  const usage = output.totalUsage;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  scoutExploreTokensUsedTotal.inc({ model, kind: "prompt" }, inputTokens);
  scoutExploreTokensUsedTotal.inc({ model, kind: "completion" }, outputTokens);
  if (model.startsWith("openai/")) {
    recordTokenUsage(inputTokens, outputTokens, model);
  }

  return {
    answer,
    preview: state.lastPreview,
    visualization: state.lastVisualization,
  };
}

type ExploreModelMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

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
  const messages = recent.map(
    (message): ExploreModelMessage =>
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

  const runReportQuery = createTool({
    id: "run_report_query",
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
          queryText: validation.formattedQueryText,
        });
        const preview = reportQueryPreviewSummary(result);
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
            preview.rows.length === 0
              ? `No rows matched after scanning ${preview.rowsScanned.toString()} rows. The data does not cover this — say so rather than estimating.`
              : `Returned ${preview.rows.length.toString()} rows after scanning ${preview.rowsScanned.toString()} rows.`,
          formattedQueryText: validation.formattedQueryText,
          preview,
        };
      }),
  });

  return {
    get_report_language: createLanguageTool(track),
    validate_report_query: createValidateTool(track),
    run_report_query: runReportQuery,
    format_report_query: createFormatTool(track),
  };
}
