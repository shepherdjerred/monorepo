/**
 * Outreach state, derived from the DM audit log.
 *
 * Budget spend, ladder position, and "have we asked for feedback?" are computed
 * from `DmAuditLog` rather than stored as counters on `GuildInstall`. Three
 * things fall out of that:
 *
 * 1. **The numbers cannot drift.** A counter updated after a successful send
 *    goes stale if that write fails, and the "Message N of 3" text we print
 *    then contradicts reality. Here the text and the gate read the same rows.
 * 2. **The rung is recorded, not reconstructed.** The Nth delivered message is
 *    not necessarily rung N — a bounced day-3 DM followed by a delivered day-14
 *    DM is rung 2, and the legacy ladder could deliver `outreach_30d` having
 *    never sent 3d or 14d. `ladderStage` on the row is the faithful answer.
 * 3. **Re-install resets for free.** Everything is scoped to rows created after
 *    `installedAt`, so moving that timestamp forward restarts the ladder — no
 *    hand-maintained list of fields to clear, which is what previously left a
 *    re-installed server permanently budget-exhausted.
 */

import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { BUDGETED_DM_KINDS } from "#src/discord/utils/message-budget.ts";

export type OutreachState = {
  /** Non-core messages delivered since install — the spent budget. */
  spent: number;
  /** Highest ladder rung delivered since install (0 = none). */
  lastLadderStage: number;
  /** Whether a feedback ask has already been delivered since install. */
  feedbackRequested: boolean;
};

/**
 * Read a guild's outreach state.
 *
 * `installedAt` is the boundary: audit rows older than it belong to a previous
 * installation and must not count against the current one.
 */
export async function readOutreachState(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  installedAt: Date,
): Promise<OutreachState> {
  const delivered = await db.dmAuditLog.findMany({
    where: {
      guildId,
      deliveryStatus: "sent",
      kind: { in: [...BUDGETED_DM_KINDS] },
      createdAt: { gte: installedAt },
    },
    select: { kind: true, ladderStage: true },
  });

  return {
    spent: delivered.length,
    lastLadderStage: delivered.reduce(
      (highest, row) => Math.max(highest, row.ladderStage ?? 0),
      0,
    ),
    feedbackRequested: delivered.some((row) => row.kind === "feedback_request"),
  };
}
