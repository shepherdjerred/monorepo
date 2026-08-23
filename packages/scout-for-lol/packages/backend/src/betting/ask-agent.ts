import { Output, stepCountIs, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { bucksAskModel } from "#src/config/dynamic.ts";
import {
  BucksAccountQueryResultSchema,
  BucksAccountQuerySchema,
  BucksAskDatasetOverviewSchema,
  BucksBetQueryResultSchema,
  BucksBetQuerySchema,
  BucksLedgerQueryResultSchema,
  BucksLedgerQuerySchema,
  type BucksAccountQuery,
  type BucksBetQuery,
  type BucksLedgerQuery,
} from "#src/betting/ask-analytics-schema.ts";
import {
  loadBucksAskAnalyticsDataset,
  type BucksAskAnalyticsDataset,
} from "#src/betting/ask-analytics.ts";
import {
  bucksAskDatasetOverview,
  queryBucksAccounts,
  queryBucksBets,
  queryBucksLedger,
} from "#src/betting/ask-analytics-query.ts";
import { getOpenRouterRuntime } from "#src/league/review/ai-clients.ts";
import {
  assertWithinBudget,
  recordTokenUsage,
} from "#src/league/review/openai-budget.ts";
import {
  scoutBucksAskTokensUsedTotal,
  scoutBucksAskToolCallsTotal,
} from "#src/metrics/bucks-ask.ts";

export const BUCKS_ASK_MODEL_LIMITS = {
  steps: 4,
  toolCalls: 5,
  aggregateCalls: 2,
  outputTokens: 2000,
  answerCharacters: 3200,
} as const;
const BUCKS_ASK_FINAL_OUTPUT_TOKEN_RESERVE = 1000;

export const BucksAskAnswerSchema = z.strictObject({
  answer: z.string().trim().min(1).max(BUCKS_ASK_MODEL_LIMITS.answerCharacters),
});

export type BucksAskToolbox = {
  getDataset: () => Promise<ReturnType<typeof bucksAskDatasetOverview>>;
  queryAccounts: (
    input: BucksAccountQuery,
  ) => Promise<ReturnType<typeof queryBucksAccounts>>;
  queryLedger: (
    input: BucksLedgerQuery,
  ) => Promise<ReturnType<typeof queryBucksLedger>>;
  queryBets: (
    input: BucksBetQuery,
  ) => Promise<ReturnType<typeof queryBucksBets>>;
};

export type BucksAskModelRequest = {
  runId: string;
  question: string;
  currentTime: string;
  model: string;
  abortSignal: AbortSignal;
  toolbox: BucksAskToolbox;
};

export type BucksAskModelResponse = {
  answer: string;
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
  };
};

export type BucksAskModelRunner = (
  request: BucksAskModelRequest,
) => Promise<BucksAskModelResponse>;

type BucksAskAgentDependencies = {
  loadDataset?: (serverId: DiscordGuildId) => Promise<BucksAskAnalyticsDataset>;
  runModel?: BucksAskModelRunner;
  getRuntime?: typeof getOpenRouterRuntime;
  now?: () => Date;
};

export type BucksAskAgentResult = {
  answer: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export class BucksAskUnavailableError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is required for Bryan Bucks analysis");
    this.name = "BucksAskUnavailableError";
  }
}

export function bucksAskStepOutputBudget(
  stepNumber: number,
  usedOutputTokens: number,
): { forceFinal: boolean; maxOutputTokens: number } {
  const remaining = BUCKS_ASK_MODEL_LIMITS.outputTokens - usedOutputTokens;
  if (remaining <= 0) {
    throw new Error("This question exhausted its Bryan Bucks output budget");
  }
  const forceFinal =
    stepNumber >= BUCKS_ASK_MODEL_LIMITS.steps - 1 ||
    remaining <= BUCKS_ASK_FINAL_OUTPUT_TOKEN_RESERVE;
  return {
    forceFinal,
    maxOutputTokens: forceFinal
      ? remaining
      : remaining - BUCKS_ASK_FINAL_OUTPUT_TOKEN_RESERVE,
  };
}

export async function runBucksAskAgent(
  params: {
    runId: string;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    question: string;
    abortSignal: AbortSignal;
  },
  dependencies: BucksAskAgentDependencies = {},
): Promise<BucksAskAgentResult> {
  return await runBucksAskAgentInternal(params, dependencies);
}

async function runBucksAskAgentInternal(
  params: {
    runId: string;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    question: string;
    abortSignal: AbortSignal;
  },
  dependencies: BucksAskAgentDependencies,
): Promise<BucksAskAgentResult> {
  const model = bucksAskModel();
  const injectedModel = dependencies.runModel !== undefined;
  const runModel =
    dependencies.runModel ??
    requireLiveModelRunner(dependencies.getRuntime ?? getOpenRouterRuntime);
  const dataset = await (
    dependencies.loadDataset ?? loadBucksAskAnalyticsDataset
  )(params.serverId);
  params.abortSignal.throwIfAborted();
  const state = { toolCalls: 0, aggregateCalls: 0, successfulToolResults: 0 };
  const toolbox = createToolbox(dataset, params.discordId, state);
  const result = await runModel({
    runId: params.runId,
    question: params.question,
    currentTime: (dependencies.now ?? readCurrentTime)().toISOString(),
    model,
    abortSignal: params.abortSignal,
    toolbox,
  });
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  if (injectedModel) {
    recordBucksAskUsage(inputTokens, outputTokens, model);
  }
  if (state.successfulToolResults === 0) {
    throw new Error(
      "The Bryan Bucks answer did not use a successful analytics tool result",
    );
  }
  const answer = BucksAskAnswerSchema.parse({ answer: result.answer }).answer;
  return { answer, model, inputTokens, outputTokens };
}

function requireLiveModelRunner(
  getRuntime: typeof getOpenRouterRuntime,
): BucksAskModelRunner {
  const runtime = getRuntime();
  if (runtime === undefined) {
    throw new BucksAskUnavailableError();
  }
  return async (request) => await runLiveModel(request, runtime);
}

function createToolbox(
  dataset: BucksAskAnalyticsDataset,
  requesterDiscordId: DiscordAccountId,
  state: {
    toolCalls: number;
    aggregateCalls: number;
    successfulToolResults: number;
  },
): BucksAskToolbox {
  const track = <Result>(
    toolName: string,
    aggregate: boolean,
    work: () => Result,
  ): Result => {
    state.toolCalls++;
    if (state.toolCalls > BUCKS_ASK_MODEL_LIMITS.toolCalls) {
      scoutBucksAskToolCallsTotal.inc({
        tool_name: toolName,
        status: "limited",
      });
      throw new Error("This question used too many Bryan Bucks tools");
    }
    if (aggregate) {
      state.aggregateCalls++;
      if (state.aggregateCalls > BUCKS_ASK_MODEL_LIMITS.aggregateCalls) {
        scoutBucksAskToolCallsTotal.inc({
          tool_name: toolName,
          status: "limited",
        });
        throw new Error("This question ran too many Bryan Bucks aggregations");
      }
    }
    try {
      const result = work();
      state.successfulToolResults++;
      scoutBucksAskToolCallsTotal.inc({
        tool_name: toolName,
        status: "success",
      });
      return result;
    } catch (error) {
      scoutBucksAskToolCallsTotal.inc({
        tool_name: toolName,
        status: "error",
      });
      throw error;
    }
  };

  return {
    getDataset: () =>
      Promise.resolve(
        track("get_bucks_dataset", false, () =>
          BucksAskDatasetOverviewSchema.parse(bucksAskDatasetOverview(dataset)),
        ),
      ),
    queryAccounts: (input) =>
      Promise.resolve(
        track("query_bucks_accounts", true, () =>
          queryBucksAccounts(
            dataset,
            BucksAccountQuerySchema.parse(input),
            requesterDiscordId,
          ),
        ),
      ),
    queryLedger: (input) =>
      Promise.resolve(
        track("query_bucks_ledger", true, () =>
          queryBucksLedger(dataset, BucksLedgerQuerySchema.parse(input)),
        ),
      ),
    queryBets: (input) =>
      Promise.resolve(
        track("query_bucks_bets", true, () =>
          queryBucksBets(dataset, BucksBetQuerySchema.parse(input)),
        ),
      ),
  };
}

async function runLiveModel(
  request: BucksAskModelRequest,
  runtime: NonNullable<ReturnType<typeof getOpenRouterRuntime>>,
): Promise<BucksAskModelResponse> {
  const agent = new ToolLoopAgent({
    id: "scout-bucks-ask-agent",
    instructions: bucksAskInstructions(request.currentTime),
    model: runtime.languageModel(request.model, ["tools"]),
    tools: {
      get_bucks_dataset: tool({
        description:
          "Describe the available Bryan Bucks dataset, overall date coverage, subjects, sample sizes, and important definitions. Its coverage is dataset-wide; never report it as a filtered query's matched coverage.",
        inputSchema: z.strictObject({}),
        outputSchema: BucksAskDatasetOverviewSchema,
        execute: request.toolbox.getDataset,
      }),
      query_bucks_accounts: tool({
        description:
          "Read only the asker's current Bryan Bucks account balance. Use this for the asker's current balance, never for another member, a leaderboard, betting profit, or earnings.",
        inputSchema: BucksAccountQuerySchema,
        outputSchema: BucksAccountQueryResultSchema,
        execute: request.toolbox.queryAccounts,
      }),
      query_bucks_ledger: tool({
        description:
          "Aggregate guild-wide Bryan Bucks seed grants, non-betting earnings, and adjustments by entry kind or day. Bettor filters and grouping are deliberately unavailable so ledger results cannot be combined with betting P&L to reconstruct private balances. Never call ledger delta betting P&L.",
        inputSchema: BucksLedgerQuerySchema,
        outputSchema: BucksLedgerQueryResultSchema,
        execute: request.toolbox.queryLedger,
      }),
      query_bucks_bets: tool({
        description:
          "Aggregate human outcome and parlay positions by position type, bettor, subject, subject result, bet direction/side, outcome, or day. Use net_bb for gross-payout-minus-stake profit/loss and sort ascending for the largest loss. staked_bb covers every matched position; gross_payout_bb, win rate, and ROI use settled won/lost positions only. Player-subject attribution applies only to outcome positions; parlays appear as multi-player.",
        inputSchema: BucksBetQuerySchema,
        outputSchema: BucksBetQueryResultSchema,
        execute: request.toolbox.queryBets,
      }),
    },
    stopWhen: stepCountIs(BUCKS_ASK_MODEL_LIMITS.steps),
    prepareStep: ({ stepNumber, steps }) => {
      assertWithinBudget();
      const outputBudget = bucksAskStepOutputBudget(
        stepNumber,
        sumUsage(steps.map((step) => step.usage.outputTokens)),
      );
      return {
        maxOutputTokens: outputBudget.maxOutputTokens,
        ...(outputBudget.forceFinal
          ? { activeTools: [], toolChoice: "none" }
          : {}),
      };
    },
    maxOutputTokens: BUCKS_ASK_MODEL_LIMITS.outputTokens,
    output: Output.object({ schema: BucksAskAnswerSchema }),
    ...runtime.callOptions({
      workload: "scout.bucks-ask",
      sessionId: request.runId,
    }),
  });
  const result = await agent.generate({
    prompt: request.question,
    abortSignal: request.abortSignal,
    onStepEnd: ({ usage }) => {
      recordBucksAskUsage(
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
        request.model,
      );
    },
  });
  const output = BucksAskAnswerSchema.parse(result.output);
  return { answer: output.answer, usage: result.usage };
}

function recordBucksAskUsage(
  inputTokens: number,
  outputTokens: number,
  model: string,
): void {
  scoutBucksAskTokensUsedTotal.inc({ model, kind: "prompt" }, inputTokens);
  scoutBucksAskTokensUsedTotal.inc({ model, kind: "completion" }, outputTokens);
  recordTokenUsage(inputTokens, outputTokens, model);
}

function sumUsage(tokens: readonly (number | undefined)[]): number {
  return tokens.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function bucksAskInstructions(currentTime: string): string {
  return `You are the Bryan Bucks analyst for one private Discord server.

Answer only questions about Bryan Bucks balances, ledger activity, betting positions, and statistics derived from the tools. Briefly refuse unrelated questions. Before every answer, including a refusal, obtain at least one successful tool result; answers without tool evidence are rejected. Every number and ranking in the answer must come from a tool result in this turn. Never estimate, invent missing data, write SQL, or imply access to data outside the tools.

The current UTC timestamp is ${currentTime}. Interpret relative periods such as today, this week, or the last seven days using UTC boundaries, pass explicit ISO timestamps to the tools, and identify UTC in the answer.

Current account balance is private to the asker. Refuse requests for another member's current balance or an on-demand balance leaderboard. Bettor identities and rankings are available only for betting statistics; ledger analytics are guild-wide and never identify individual bettors.

Use a concise, straight-analyst tone. State the matched sample size and the result's date coverage. Every grouped result reports returnedRows, totalGroups, and truncated; when truncated is true, explicitly call the rows a partial top/bottom list and never describe them as exhaustive. If the sample is thin, empty, unresolved, or an alias is unknown, say so. Discord identities may be written as the exact non-pinging <@id> labels returned by tools.

Keep these definitions exact:
- Current balance, ledger delta, and betting P&L are different measures.
- Betting P&L is gross payout minus stake for settled won/lost positions only.
- Generic betting totals include both outcome and parlay positions. Use positionTypes only when the question explicitly narrows to one type.
- Refunds are zero net and excluded from win rate and ROI; pending positions have no P&L.
- Bet date coverage uses settlement time when present and creation time otherwise.
- An outcome bet's subject is the tracked player it was framed around. Attribute gain/loss to that framing; do not claim the player literally caused the bettor's result. Parlays are multi-player and must not be attributed to one subject.
- Canceled positions were deleted by the betting workflow and are not in position statistics.
- Bryan Bucks are BB, not real money.

Use these query rules:
- "Who lost the most betting on X?" means query outcome bets grouped by bettor, filter only by subject alias X, and sort net_bb ascending. Do not add outcome, subject-result, or for/against filters unless the question explicitly requests them. Negative net_bb is the loss.
- "Who gained the most betting on X?" uses the same query sorted by net_bb descending.
- "Which player is attributed the most gain/loss?" groups by subject and sorts net_bb in the requested direction.
- If an alias-filtered query returns no rows and ambiguousSubjectAliases is non-empty, say that the historical alias belongs to multiple players and the tool cannot safely combine it. For an unfiltered subject grouping, colliding current aliases are returned with stable "[player N]" labels; preserve those labels and explain that they are distinct PUUIDs sharing the same displayed alias.
- If a bet query returns zero rows for an alias listed in availableSubjectAliases and both unknownSubjectAliases and ambiguousSubjectAliases are empty, retry once with only the requested subjectAliases filter before concluding there is no data. Remove every outcome, subject-result, direction, bettor, and date filter the question did not explicitly request.
- Use each filtered query's coverage for its sample size and date range. Dataset overview coverage is never a substitute. If matched coverage dates are null, say that no matched date range exists; do not quote dataset-wide dates.

Keep the answer under 3,200 characters and do not include a Markdown table.`;
}

function readCurrentTime(): Date {
  return new Date();
}
