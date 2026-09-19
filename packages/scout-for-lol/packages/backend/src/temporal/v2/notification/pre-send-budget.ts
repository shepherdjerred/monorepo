import { NOTIFICATION_PRE_SEND_BUDGET_MS } from "@scout-for-lol/temporal/activity-contracts-v2";

/**
 * The budget the delivery Activity gives everything it does before Discord.
 *
 * `deliverNotificationV2` runs with `maximumAttempts: 1`, so any failure the
 * Workflow cannot attribute becomes `unknown-delivery` — a dead end only an
 * operator leaves, and the right answer for a Discord request that may have
 * posted a message before its response was lost. It is the wrong answer for
 * everything BEFORE that request: the intent read, the policy gate, the guild
 * lookup, the receipt read and the object fetch provably send nothing, and a
 * heartbeat or start-to-close timeout during them would park a notification
 * that never left while an operator investigates a send that never happened.
 *
 * The Activity therefore answers its own pre-send failures inside a budget
 * strictly shorter than the timeouts that would otherwise answer for it. A
 * slow object store stops being an ambiguity and becomes what it is: a
 * definite, retryable non-send, reported while the Activity is still alive to
 * report it.
 */
export class PreSendBudgetExpiredError extends Error {
  constructor(intentKey: string) {
    super(
      `Preparing the notification for ${intentKey} did not finish within its ${String(NOTIFICATION_PRE_SEND_BUDGET_MS)}ms pre-send budget; nothing was sent`,
    );
    this.name = "PreSendBudgetExpiredError";
  }
}

/**
 * Run one pre-send phase under the budget, and cancel what it started.
 *
 * The signal reaches the object-store read, which genuinely aborts. The rule
 * against racing an uncancellable promise is about abandoned EFFECTS; what
 * remains here are idempotent reads — Postgres rows and one Discord channel
 * GET — which change nothing whether they finish or not. What must not happen
 * is the Activity being killed mid-preparation by a clock it does not control,
 * and the race is what guarantees it is not.
 */
export async function withPreSendBudget<T>(
  intentKey: string,
  run: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const budget = setTimeout(() => {
    controller.abort();
  }, NOTIFICATION_PRE_SEND_BUDGET_MS);
  try {
    return await Promise.race([
      run(controller.signal),
      expiry(controller.signal, intentKey),
    ]);
  } finally {
    clearTimeout(budget);
  }
}

/** Rejects when the budget lapses, and never settles otherwise. */
function expiry(signal: AbortSignal, intentKey: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new PreSendBudgetExpiredError(intentKey));
      },
      { once: true },
    );
  });
}
