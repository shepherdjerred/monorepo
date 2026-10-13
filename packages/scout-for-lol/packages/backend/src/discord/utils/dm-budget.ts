import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import type { DmKind, DmBudget } from "#src/discord/utils/dm-contracts.ts";
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";
import {
  BUDGETED_DM_KINDS,
  messageBudgetFooter,
  NON_CORE_MESSAGE_BUDGET,
  RECIPIENT_COOLDOWN_MS,
} from "#src/discord/utils/message-budget.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
const logger = createLogger("discord-dm-budget");

async function reserveDeliveryRow(
  db: Db,
  row: {
    recipientId: string;
    recipientTag: string | undefined;
    guildId: DiscordGuildId | undefined;
    kind: DmKind;
    content: string;
    ladderStage: number | undefined;
  },
): Promise<number | null> {
  try {
    const created = await db.dmAuditLog.create({
      data: {
        recipientId: row.recipientId,
        recipientTag: row.recipientTag ?? null,
        guildId: row.guildId ?? null,
        kind: row.kind,
        content: row.content,
        deliveryStatus: "reserved",
        ladderStage: row.ladderStage ?? null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    logger.error(
      `[DM] Failed to reserve a ledger row for ${row.recipientId}:`,
      getErrorMessage(error),
    );
    return null;
  }
}

type BudgetDecision =
  | { kind: "allow"; messageNumber: number }
  | { kind: "budget_exhausted" }
  | { kind: "deferred" };

/**
 * Decide whether a budgeted message may be sent right now.
 *
 * Two independent limits: the per-server lifetime budget, and a per-recipient
 * cooldown so someone who installed Scout in several guilds at once is not DM'd
 * several times on the same day.
 */
async function evaluateBudget(
  db: Db,
  budget: DmBudget,
  recipientId: DiscordAccountId,
): Promise<BudgetDecision> {
  const { spent } = await readOutreachState(
    db,
    budget.guildId,
    budget.installedAt,
  );
  if (spent >= NON_CORE_MESSAGE_BUDGET) {
    return { kind: "budget_exhausted" };
  }

  const cutoff = new Date(Date.now() - RECIPIENT_COOLDOWN_MS);
  const recent = await db.dmAuditLog.findFirst({
    where: {
      recipientId,
      deliveryStatus: { in: ["sent", "reserved", "unknown"] },
      // Every budgeted kind, not just the `outreach`-prefixed ones — the ladder
      // sends `feedback_request` to configured guilds, and an installer with
      // several of those would otherwise be DM'd about all of them at once.
      kind: { in: [...BUDGETED_DM_KINDS] },
      createdAt: { gt: cutoff },
    },
    select: { id: true },
  });
  if (recent !== null) {
    // Deferred, not dropped: the next daily run re-evaluates this guild.
    return { kind: "deferred" };
  }

  return { kind: "allow", messageNumber: spent + 1 };
}

/** Reserve under database locks, shared by every process and the intent minter. */
export async function reserveBudgetedDm(
  db: Db,
  input: {
    recipientId: DiscordAccountId;
    guildId: DiscordGuildId;
    kind: DmKind;
    message: string;
    budget: DmBudget;
  },
): Promise<
  | { status: "reserved"; id: number; message: string }
  | { status: "budget_exhausted" | "deferred" }
> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scout-dm-recipient:${input.recipientId}`}, 0))`;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scout-dm-guild:${input.budget.guildId}`}, 0))`;
  const decision = await evaluateBudget(db, input.budget, input.recipientId);
  if (decision.kind !== "allow") return { status: decision.kind };
  const message = truncateDiscordMessage(
    input.message +
      messageBudgetFooter({
        serverName: input.budget.serverName,
        messageNumber: decision.messageNumber,
      }),
  );
  const id = await reserveDeliveryRow(db, {
    recipientId: input.recipientId,
    recipientTag: undefined,
    guildId: input.guildId,
    kind: input.kind,
    content: message,
    ladderStage: input.budget.ladderStage,
  });
  if (id === null)
    throw new Error("Could not commit the DM budget reservation");
  return { status: "reserved", id, message };
}
