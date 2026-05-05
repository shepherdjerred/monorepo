import config from "#src/configuration.ts";
import {
  scoutOpenaiBudgetExceededTotal,
  scoutOpenaiTokensUsedTotal,
} from "#src/metrics/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("openai-budget");

// Top-level safety net: track OpenAI tokens consumed and refuse calls that
// would exceed the configured hourly/daily budget. Catches *any* runaway
// loop, even from code paths we haven't written yet. Single-replica
// deployment, so module-level in-memory state is sufficient — a budget
// reset on restart is acceptable.

export type BudgetWindow = "hourly" | "daily";

export class OpenAIBudgetExceeded extends Error {
  readonly window: BudgetWindow;
  readonly used: number;
  readonly budget: number;

  constructor(window: BudgetWindow, used: number, budget: number) {
    super(
      `OpenAI ${window} token budget exceeded: ${used.toString()} / ${budget.toString()}`,
    );
    this.name = "OpenAIBudgetExceeded";
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
  budget: config.openaiHourlyTokenBudget,
  startedAt: Date.now(),
  tokensUsed: 0,
};

const daily: Window = {
  window: "daily",
  durationMs: DAY_MS,
  budget: config.openaiDailyTokenBudget,
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
 * Throws `OpenAIBudgetExceeded` if the next call would push us over the
 * hourly or daily budget. Call before every `chat.completions.create`.
 */
export function assertWithinBudget(): void {
  rollIfElapsed(hourly);
  rollIfElapsed(daily);

  if (hourly.tokensUsed >= hourly.budget) {
    scoutOpenaiBudgetExceededTotal.inc({ window: "hourly" });
    throw new OpenAIBudgetExceeded("hourly", hourly.tokensUsed, hourly.budget);
  }
  if (daily.tokensUsed >= daily.budget) {
    scoutOpenaiBudgetExceededTotal.inc({ window: "daily" });
    throw new OpenAIBudgetExceeded("daily", daily.tokensUsed, daily.budget);
  }
}

/**
 * Records token usage from a successful OpenAI response. Increments both the
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
    `📊 OpenAI usage: +${total.toString()} tokens (${model}); hourly ${hourly.tokensUsed.toString()}/${hourly.budget.toString()}, daily ${daily.tokensUsed.toString()}/${daily.budget.toString()}`,
  );
}

/** For tests: reset both windows to zero. */
export function resetBudgetStateForTests(): void {
  hourly.startedAt = Date.now();
  hourly.tokensUsed = 0;
  daily.startedAt = Date.now();
  daily.tokensUsed = 0;
}
