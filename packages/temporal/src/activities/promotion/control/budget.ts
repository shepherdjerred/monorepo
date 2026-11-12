import { costForTextUsage } from "@shepherdjerred/llm-models";
import type { z } from "zod/v4";
import type { PromotionStore } from "#activities/promotion/store.ts";
import type { AgentTurnUsage } from "#lib/agent-runner/contract.ts";
import { SolverBudgetSchema } from "#activities/promotion/store.ts";
import {
  PromotionAiLedgerSchema,
  promotionAiAccounting,
} from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";
export class PromotionBudgetStop extends Error {}

const Ledger = PromotionAiLedgerSchema;

export function promotionSpendDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function dailyPromotionSolverCharges(
  store: PromotionStore,
  date = new Date(),
) {
  const previous = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1),
  );
  const ledgers = await Promise.all(
    [date, previous].map((month) =>
      store.read(
        `solver/${month.toISOString().slice(0, 7)}.json`,
        SolverBudgetSchema,
      ),
    ),
  );
  return ledgers
    .flatMap((row) => Object.values(row?.value.charges ?? {}))
    .filter(
      (charge) =>
        charge.createdAt !== undefined &&
        promotionSpendDay(new Date(charge.createdAt)) ===
          promotionSpendDay(date),
    );
}

/** Sequential local runner: check recorded spend before each task, then record usage.
 * Missing usage stays unknown, without a hypothetical charge.
 * This is an operational stop, not a provider-side billing guarantee.
 */
export async function reservePromotionAi(
  store: PromotionStore,
  occurrenceId: string,
  settings: { model: string; dailySpendUsd: number },
) {
  const day = promotionSpendDay();
  const key = `ai/daily/${day}.json`;
  async function change(
    update: (ledger: z.infer<typeof Ledger>) => z.infer<typeof Ledger>,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await store.read(key, Ledger);
      if (await store.put(key, update(current?.value ?? {}), current?.etag))
        return;
    }
    throw new Error("Concurrent daily spend update did not settle");
  }
  const solver = await dailyPromotionSolverCharges(store);
  const solverUsd =
    solver.reduce(
      (sum, charge) =>
        sum + (charge.chargedMicrousd ?? charge.reservedMicrousd),
      0,
    ) / 1_000_000;
  await change((ledger) => {
    const accounting = promotionAiAccounting(Object.values(ledger));
    const spent = accounting.aiUsd + accounting.allocatedAiUsd + solverUsd;
    if (accounting.unallocatedUnknownAi > 0)
      throw new PromotionBudgetStop(
        "Previous AI usage is unknown; stop until accounted for",
      );
    if (spent >= settings.dailySpendUsd)
      throw new PromotionBudgetStop(
        `Daily promotion spend limit reached ($${String(settings.dailySpendUsd)} AI + CAPTCHA)`,
      );
    if (ledger[occurrenceId] !== undefined)
      throw new Error("AI occurrence already recorded");
    return {
      ...ledger,
      [occurrenceId]: {
        reservedUsd: 0,
        chargedUsd: null,
        model: settings.model,
      },
    };
  });
  return async (usage: AgentTurnUsage) => {
    const chargedUsd = costForTextUsage(settings.model, usage);
    if (chargedUsd === undefined)
      throw new Error("Cannot price AI usage; cost remains unknown");
    await change((ledger) => {
      if (
        ledger[occurrenceId] === undefined ||
        ledger[occurrenceId].budgetAllocation !== undefined
      )
        throw new Error("AI reservation disappeared or was already allocated");
      return {
        ...ledger,
        [occurrenceId]: { reservedUsd: 0, chargedUsd, model: settings.model },
      };
    });
  };
}
