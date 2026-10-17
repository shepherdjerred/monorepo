import type { FileContext } from "#automation/files/types.ts";
import { now, FileGuardError } from "#automation/files/types.ts";
import type {
  SubtitleReplacementInput,
  SubtitleReplacementResult,
} from "#shared/subtitle-replacement.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  lockReplacement,
  assertReplacementSnapshot,
  assertReplacementOperation,
} from "./authority.ts";
import { observeReplacement } from "./files.ts";

export async function prepareReplacement(
  context: FileContext,
  input: SubtitleReplacementInput,
): Promise<SubtitleReplacementResult> {
  const initial = await context.db.$transaction(async (tx) => {
    const { row } = await lockReplacement(tx, input.replacementId);
    await assertReplacementOperation(tx, input, [
      "prepare_subtitle_replacement",
    ]);
    if (row.review !== null) return row;
    if (row.state !== "preparing")
      throw new FileGuardError("subtitle_replacement_state_changed");
    await assertReplacementSnapshot(tx, row.id);
    return row;
  });
  if (initial.review !== null) return { state: "ready" };
  const prepared = await observeReplacement(context, initial);
  await context.db.$transaction(async (tx) => {
    const { row } = await lockReplacement(tx, input.replacementId);
    await assertReplacementOperation(tx, input, [
      "prepare_subtitle_replacement",
    ]);
    await assertReplacementSnapshot(tx, row.id);
    if (row.review !== null) return;
    if (row.state !== "preparing")
      throw new FileGuardError("subtitle_replacement_state_changed");
    await prepared.content.digest(prepared.paths.video);
    await prepared.content.digest(prepared.paths.target);
    await tx.subtitleReplacementReview.create({
      data: {
        replacementId: row.id,
        observation: prepared.observation,
        observationHash: snapshotHash(prepared.observation),
        expiresAt: new Date(now(context).getTime() + 15 * 60_000),
      },
    });
    await tx.subtitleReplacement.update({
      where: { id: row.id },
      data: {
        state: "awaiting_review",
        reason: null,
        version: { increment: 1 },
      },
    });
  });
  return { state: "ready" };
}
