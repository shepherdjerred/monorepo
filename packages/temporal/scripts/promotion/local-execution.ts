import { z } from "zod/v4";
import { LocalPromotionStop } from "./local-stop.ts";
import { localOwnerAlive } from "./process-owner.ts";
import {
  promotionDispatchAt,
  promotionFailurePause,
  promotionRunBlocked,
  type PromotionRunInput,
  type PromotionTarget,
} from "#shared/promotion.ts";
import {
  assertPromotionOwnership,
  type readPromotionState,
  updatePromotionState,
  type PromotionStore,
} from "#activities/promotion/store.ts";

function assertClosedLocalOwner(
  occurrenceId: string,
  mode: PromotionRunInput["mode"],
  acquiredAt: string,
) {
  const pid = /^local\/(\d+)\//.exec(occurrenceId)?.[1];
  if (mode !== "reconcile" || pid === undefined)
    throw new LocalPromotionStop(
      "owner",
      "Target has an outstanding owner; inspect and reconcile it first",
    );
  if (localOwnerAlive(Number(pid), acquiredAt)) {
    throw new LocalPromotionStop(
      "owner",
      "Previous local executor is still running",
    );
  }
}

export const LocalPromotionSettings = z.strictObject({
  model: z.string().min(1).default("gpt-5.6-luna"),
  maxSteps: z.number().int().min(1).max(80).default(80),
  timeoutMinutes: z.number().int().min(1).max(15).default(15),
  dailySpendUsd: z.number().nonnegative().max(5).default(5),
  monthlySolverUsd: z.number().nonnegative().max(10).default(10),
});

/** Claim before opening any external transport; ambiguous effects retain ownership. */
export async function executeLocalPromotion<T>(input: {
  target: PromotionTarget;
  mode: PromotionRunInput["mode"];
  store: PromotionStore;
  execute: (claim: {
    occurrenceId: string;
    state: Awaited<ReturnType<typeof readPromotionState>>;
  }) => Promise<T>;
}) {
  const { target, mode, store } = input;
  const occurrenceId = `local/${String(process.pid)}/${target.id}/${crypto.randomUUID()}`;
  const state = await updatePromotionState(store, target.id, (current) => {
    if (current.lock !== null) {
      assertClosedLocalOwner(
        current.lock.occurrenceId,
        mode,
        current.lock.acquiredAt,
      );
    }
    if (mode === "run") {
      if (promotionRunBlocked(current))
        throw new LocalPromotionStop(
          current.paused || promotionFailurePause(current) !== null
            ? "paused"
            : "uncertain",
          promotionFailurePause(current) ??
            current.blockedReason ??
            "Target is paused",
        );
      if (current.attempts.some((attempt) => attempt.status === "uncertain"))
        throw new LocalPromotionStop(
          "uncertain",
          "Prior submission needs reconciliation",
        );
      const due = promotionDispatchAt(target, current);
      if (due > Date.now())
        throw new LocalPromotionStop(
          "cooldown",
          `Cooldown until ${new Date(due).toISOString()}`,
        );
    }
    return {
      ...current,
      lock: { occurrenceId, acquiredAt: new Date().toISOString() },
      lastOccurrenceId: occurrenceId,
    };
  });
  try {
    return await input.execute({ occurrenceId, state });
  } finally {
    await updatePromotionState(store, target.id, (current) => {
      assertPromotionOwnership(current, occurrenceId);
      const uncertain = current.attempts.some(
        (attempt) => attempt.status === "uncertain",
      );
      return {
        ...current,
        lock: uncertain ? current.lock : null,
        blockedReason: uncertain
          ? "Submission outcome uncertain; reconcile before running again"
          : mode === "reconcile"
            ? null
            : current.blockedReason,
      };
    });
  }
}
