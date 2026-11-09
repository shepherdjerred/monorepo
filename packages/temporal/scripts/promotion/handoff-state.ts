import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import { PromotionStateSchema } from "#shared/promotion.ts";
import { PROMOTION_PREFIX } from "#activities/promotion/store.ts";
import { PromotionBatchSchema } from "@shepherdjerred/ops-model/promotion/model.ts";
import { localOwnerAlive } from "./process-owner.ts";

export function assertHandoffIdle(value: unknown) {
  const owner = z
    .object({ pid: z.number().nullable(), acquiredAt: z.string().optional() })
    .parse(value);
  if (owner.pid !== null && localOwnerAlive(owner.pid, owner.acquiredAt))
    throw new Error("Local executor must stop before handoff");
}

export function handoffBatch(value: unknown) {
  const batch = PromotionBatchSchema.parse(value);
  if (batch.finishedAt === null) {
    if (localOwnerAlive(batch.pid, batch.startedAt))
      throw new Error("An imported batch is still running");
    batch.interrupted = true;
  }
  return batch;
}

export async function handoffState(
  value: unknown,
  root: string,
  artifacts: Map<string, Uint8Array>,
) {
  const state = PromotionStateSchema.parse(value);
  if (state.lock !== null) {
    const pid = /^local\/(\d+)\//.exec(state.lock.occurrenceId)?.[1];
    if (
      pid === undefined ||
      localOwnerAlive(Number(pid), state.lock.acquiredAt)
    )
      throw new Error(`Unclosed owner for ${state.targetId}`);
    state.lock = null;
  }
  for (const attempt of state.attempts)
    attempt.evidenceKey = await handoffEvidence(
      attempt.evidenceKey,
      root,
      artifacts,
    );
  if (state.attempts.some((a) => a.status === "uncertain"))
    state.blockedReason =
      "Imported unresolved action; duplicate prevention remains active";
  return state;
}

async function handoffEvidence(
  file: string | null,
  root: string,
  artifacts: Map<string, Uint8Array>,
) {
  if (file === null) return null;
  const actual = await realpath(file);
  if (
    !actual.startsWith(root + path.sep) ||
    ![".png", ".json"].includes(path.extname(actual))
  )
    throw new Error("Evidence escapes handoff directory");
  const bytes = new Uint8Array(await Bun.file(actual).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `${PROMOTION_PREFIX}/prod/evidence/imports/${hash}${path.extname(actual)}`;
  artifacts.set(key, bytes);
  return key;
}
