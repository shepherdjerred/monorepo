import { randomInt } from "node:crypto";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { z } from "zod/v4";
import {
  initialPromotionState,
  PromotionStateSchema,
  type PromotionState,
} from "#shared/promotion.ts";
import {
  conditionalWrite,
  readJson,
  reportReceiptStore,
  writeJson,
  type ReportReceiptStore,
} from "#activities/reports/report-object-store.ts";

export const PROMOTION_PREFIX = "storm/promotion/v1";

export function promotionStoragePrefix(): string {
  return `${PROMOTION_PREFIX}/${parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"])}`;
}

export type PromotionStore = {
  read: <T>(
    key: string,
    schema: z.ZodType<T>,
  ) => Promise<{ value: T; etag: string } | undefined>;
  put: (
    key: string,
    value: unknown,
    expectedEtag: string | undefined,
  ) => Promise<boolean>;
};

export function promotionStore(
  storage: ReportReceiptStore = reportReceiptStore(),
): PromotionStore {
  const prefix = promotionStoragePrefix();
  return {
    read: (key, schema) => readJson(storage, `${prefix}/${key}`, schema),
    put: (key, value, expectedEtag) =>
      conditionalWrite(() =>
        writeJson(storage, `${prefix}/${key}`, value, {
          expectedEtag,
        }),
      ),
  };
}

export async function readPromotionState(
  store: PromotionStore,
  targetId: string,
): Promise<PromotionState> {
  const key = `targets/${targetId}.json`;
  const existing = await store.read(key, PromotionStateSchema);
  if (existing !== undefined) return existing.value;
  const state = initialPromotionState(targetId, randomInt(900, 1801));
  if (await store.put(key, state, undefined)) return state;
  const winner = await store.read(key, PromotionStateSchema);
  if (winner === undefined)
    throw new Error("Promotion initialization lost its stored state");
  return winner.value;
}

export async function updatePromotionState(
  store: PromotionStore,
  targetId: string,
  change: (value: PromotionState) => PromotionState,
): Promise<PromotionState> {
  await readPromotionState(store, targetId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.read(
      `targets/${targetId}.json`,
      PromotionStateSchema,
    );
    if (current === undefined) throw new Error("Promotion state disappeared");
    const changed = PromotionStateSchema.parse(change(current.value));
    if (await store.put(`targets/${targetId}.json`, changed, current.etag))
      return changed;
  }
  throw new Error("Concurrent promotion state update did not settle");
}

/** Locks never expire automatically: a timed-out browser write may still settle. */
export function assertPromotionOwnership(
  state: PromotionState,
  occurrenceId: string,
): void {
  if (state.lock?.occurrenceId !== occurrenceId)
    throw new Error("Promotion occurrence no longer owns the target");
}

const SolverChargeSchema = z.strictObject({
  occurrenceId: z.string(),
  taskId: z.number().int().positive().nullable(),
  reservedMicrousd: z.number().int().nonnegative(),
  chargedMicrousd: z.number().int().nonnegative().nullable(),
});
export const SolverBudgetSchema = z.strictObject({
  version: z.literal(1),
  charges: z.record(z.string(), SolverChargeSchema),
});
export type SolverBudget = z.infer<typeof SolverBudgetSchema>;

export async function updateSolverBudget(
  store: PromotionStore,
  month: string,
  change: (value: SolverBudget) => SolverBudget,
): Promise<SolverBudget> {
  const key = `solver/${month}.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.read(key, SolverBudgetSchema);
    const next = SolverBudgetSchema.parse(
      change(current?.value ?? { version: 1, charges: {} }),
    );
    if (await store.put(key, next, current?.etag)) return next;
  }
  throw new Error("Concurrent solver budget update did not settle");
}

export function solverReservedMicrousd(budget: SolverBudget): number {
  return Object.values(budget.charges).reduce(
    (sum, item) => sum + (item.chargedMicrousd ?? item.reservedMicrousd),
    0,
  );
}
