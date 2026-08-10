import config from "#src/configuration.ts";
import {
  scoutOpenaiBudgetExceededTotal,
  scoutOpenaiTokensUsedTotal,
} from "#src/metrics/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("llm-budget");

// Top-level safety net: track LLM tokens consumed and refuse calls that would
// exceed the configured hourly/daily budget. The historical metric symbol and
// series names remain stable across the OpenRouter cutover. Single-replica
// deployment makes module-level in-memory state sufficient; a budget reset on
// restart is acceptable.

export type BudgetWindow = "hourly" | "daily";

export class LlmBudgetExceeded extends Error {
  readonly window: BudgetWindow;
  readonly used: number;
  readonly budget: number;

  constructor(window: BudgetWindow, used: number, budget: number) {
    super(
      `LLM ${window} token budget exceeded: ${used.toString()} / ${budget.toString()}`,
    );
    this.name = "LlmBudgetExceeded";
    this.window = window;
    this.used = used;
    this.budget = budget;
  }
}

type Window = {
  readonly window: BudgetWindow;
  readonly durationMs: number;
  readonly budget: number;
  startedAt: number;
  tokensUsed: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const hourly: Window = {
  window: "hourly",
  durationMs: HOUR_MS,
  budget: config.llmHourlyTokenBudget,
  startedAt: Date.now(),
  tokensUsed: 0,
};

const daily: Window = {
  window: "daily",
  durationMs: DAY_MS,
  budget: config.llmDailyTokenBudget,
  startedAt: Date.now(),
  tokensUsed: 0,
};

function rollIfElapsed(w: Window): void {
  const now = Date.now();
  if (now - w.startedAt >= w.durationMs) {
    w.startedAt = now;
    w.tokensUsed = 0;
  }
}

/**
 * Throws `LlmBudgetExceeded` if the next call would push us over the hourly or
 * daily budget. Call before every model generation.
 */
export function assertWithinBudget(): void {
  rollIfElapsed(hourly);
  rollIfElapsed(daily);

  if (hourly.tokensUsed >= hourly.budget) {
    scoutOpenaiBudgetExceededTotal.inc({ window: "hourly" });
    throw new LlmBudgetExceeded("hourly", hourly.tokensUsed, hourly.budget);
  }
  if (daily.tokensUsed >= daily.budget) {
    scoutOpenaiBudgetExceededTotal.inc({ window: "daily" });
    throw new LlmBudgetExceeded("daily", daily.tokensUsed, daily.budget);
  }
}

/**
 * Records token usage from a successful model response. Increments both the
 * hourly/daily counters and the Prometheus metric (labelled by model+kind).
 */
export function recordTokenUsage(
  promptTokens: number,
  completionTokens: number,
  model: string,
): void {
  const total = promptTokens + completionTokens;
  hourly.tokensUsed += total;
  daily.tokensUsed += total;
  scoutOpenaiTokensUsedTotal.inc({ model, kind: "prompt" }, promptTokens);
  scoutOpenaiTokensUsedTotal.inc(
    { model, kind: "completion" },
    completionTokens,
  );
  logger.info(
    `📊 LLM usage: +${total.toString()} tokens (${model}); hourly ${hourly.tokensUsed.toString()}/${hourly.budget.toString()}, daily ${daily.tokensUsed.toString()}/${daily.budget.toString()}`,
  );
}

/** For tests: reset both windows to zero. */
export function resetBudgetStateForTests(): void {
  hourly.startedAt = Date.now();
  hourly.tokensUsed = 0;
  daily.startedAt = Date.now();
  daily.tokensUsed = 0;
}
