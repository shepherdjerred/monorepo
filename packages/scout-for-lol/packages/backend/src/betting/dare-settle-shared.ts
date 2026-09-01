import {
  BucksDareHorizonKindSchema,
  type BucksDareHorizonKind,
} from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { summarizeDareBestEffort } from "#src/betting/dare-common.ts";
import {
  DareConditionsSchema,
  DareTargetAccountsSchema,
  renderDareConditions,
  type DareConditions,
  type DareTargetIdentity,
} from "#src/betting/dare-criteria.ts";
import {
  dareMoneyFactsInTransaction,
  refundDareContributionsInTransaction,
  type DareContributorRefund,
  type DareLedgerFacts,
  type DareTargetPayout,
} from "#src/betting/dare-ledger.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  bettingDareSettlementsTotal,
  bettingDaresTotal,
} from "#src/metrics/betting.ts";

/**
 * Types and refund/void helpers shared between `dare-settle.ts` (match-driven
 * capture) and `dare-sweep.ts` (clock-driven sweeps). Split out purely to
 * keep `dare-settle.ts` under the repo's 500-line cap — every symbol here is
 * consumed by both callers.
 */

export type DareResolution =
  "captured" | "achieved" | "unachieved" | "voided" | "expired" | "abandoned";

/**
 * What one dare resolution (or progress capture) looked like, for the
 * Discord delivery layer to announce. The domain stays Discord-free: it
 * returns these and never sends anything.
 */
export type DareSettlementSummary = {
  dareId: number;
  serverId: string;
  channelId: string;
  /** JSON BucksMessageRef for the public callout, when one was recorded. */
  messageRef: string | null;
  matchId: string | undefined;
  resolution: DareResolution;
  horizonKind: BucksDareHorizonKind;
  challengerDiscordId: string;
  targetAliases: string[];
  conditionSummary: string;
  potTotal: number;
  /** Per-target payouts — populated only for `achieved`. */
  payouts: DareTargetPayout[];
  /** Per-contributor refunds — populated for `unachieved`, `voided`, and
   * `expired`. */
  refunds: DareContributorRefund[];
  voidReason: string | undefined;
  /** Per-leaf qualifying-game counts after this capture, canonical order. */
  leafCounts: number[] | undefined;
};

/**
 * Thrown by {@link import("#src/betting/dare-settle.ts").settleDaresForMatch}
 * when at least one dare in the batch exhausted its retries. Carries every
 * summary this call DID successfully commit before the failure, because a
 * later dare's failure must never discard an earlier dare's already-terminal,
 * already-committed result — that result cannot be reproduced on retry (the
 * discovery query only ever re-selects `active` dares, and this one no
 * longer is). The caller is expected to deliver `summaries` before
 * propagating the failure.
 */
export class DarePartialSettlementError extends Error {
  readonly summaries: readonly DareSettlementSummary[];
  constructor(summaries: readonly DareSettlementSummary[], cause: unknown) {
    super("One or more dares failed to settle after exhausting retries", {
      cause,
    });
    this.name = "DarePartialSettlementError";
    this.summaries = summaries;
  }
}

/** One dare row plus its frozen target rows, exactly as Prisma loads them —
 * the include shape every settle/sweep read shares. */
export type ActiveDareRow = Prisma.BucksDareGetPayload<{
  include: { targets: true };
}>;

/**
 * The row facts every refund, void, abandon, and expire path needs. The
 * condition summary is BEST-EFFORT (display-only placeholder when the stored
 * blob no longer parses), because money movement on those paths must never
 * depend on a parse — the documented refunds-are-never-blocked invariant.
 */
export type DareRefundView = {
  row: ActiveDareRow;
  horizonKind: BucksDareHorizonKind;
  facts: DareLedgerFacts;
};

export type ParsedDare = DareRefundView & {
  conditions: DareConditions;
  targets: DareTargetIdentity[];
};

function baseFacts(
  row: ActiveDareRow,
  conditionSummary: string,
  matchId?: string,
): DareLedgerFacts {
  return {
    dareId: row.id,
    serverId: row.serverId,
    potTotal: row.potTotal,
    targetAliases: row.targets.map((target) => target.alias),
    conditionSummary,
    matchId,
  };
}

/** Refund-path view of a dare row: no strict conditions parse anywhere. */
export function dareRefundView(
  row: ActiveDareRow,
  matchId?: string,
): DareRefundView {
  return {
    row,
    horizonKind: BucksDareHorizonKindSchema.parse(row.horizonKind),
    facts: baseFacts(row, summarizeDareBestEffort(row), matchId),
  };
}

/** Strict settlement-path parse: an unreadable conditions blob fails loudly
 * here, because evaluation cannot be best-effort. */
export function parseDare(row: ActiveDareRow, matchId?: string): ParsedDare {
  const conditions = DareConditionsSchema.parse(JSON.parse(row.conditions));
  const targets: DareTargetIdentity[] = row.targets.map((target) => ({
    discordId: target.discordId,
    alias: target.alias,
    accounts: DareTargetAccountsSchema.parse(JSON.parse(target.accounts)),
  }));
  const targetAliases = row.targets.map((target) => target.alias);
  return {
    row,
    conditions,
    targets,
    horizonKind: BucksDareHorizonKindSchema.parse(row.horizonKind),
    facts: baseFacts(
      row,
      renderDareConditions(conditions, targetAliases),
      matchId,
    ),
  };
}

export function baseSummary(
  dare: DareRefundView,
  resolution: DareResolution,
  matchId?: string,
): DareSettlementSummary {
  return {
    dareId: dare.row.id,
    serverId: dare.row.serverId,
    channelId: dare.row.channelId,
    messageRef: dare.row.messageRef,
    matchId,
    resolution,
    horizonKind: dare.horizonKind,
    challengerDiscordId: dare.row.challengerDiscordId,
    targetAliases: [...dare.facts.targetAliases],
    conditionSummary: dare.facts.conditionSummary,
    potTotal: dare.row.potTotal,
    payouts: [],
    refunds: [],
    voidReason: undefined,
    leafCounts: undefined,
  };
}

export type DareVoidReason = "unknown_evaluator" | "storage_overflow";

/**
 * Void an active dare with FULL refunds and no cut, in its own transaction.
 *
 * Two callers: a stored evaluator version this code no longer implements
 * (capture and the window sweep), and a payout that cannot be persisted
 * without overflowing Int32 wallet storage (the weekly-parlay
 * `storage_overflow` precedent). Returns undefined when another resolution
 * won the claim. Deliberately takes a `DareRefundView`, never a `ParsedDare`:
 * voiding must not require the conditions blob to parse.
 */
export async function voidDareWithFullRefund(
  dare: DareRefundView,
  prismaClient: ExtendedPrismaClient,
  now: Date,
  input: { voidReason: DareVoidReason; surface: "postmatch" | "sweep" },
): Promise<DareSettlementSummary | undefined> {
  const outcome = await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksDare.updateMany({
      where: { id: dare.row.id, dareState: "active" },
      data: {
        dareState: "voided",
        voidReason: input.voidReason,
        settledAt: now,
      },
    });
    if (claim.count !== 1) {
      return;
    }
    const facts = await dareMoneyFactsInTransaction(tx, dare.facts);
    const refunds = await refundDareContributionsInTransaction(tx, {
      facts,
      resolution: "voided",
      withCut: false,
      voidReason: input.voidReason,
    });
    return { refunds, potTotal: facts.potTotal };
  });
  if (outcome === undefined) return undefined;
  bettingDaresTotal.inc({ result: "voided" });
  bettingDareSettlementsTotal.inc({ outcome: "voided" });
  logBucksTransition({
    event: "bucks.dare.voided",
    serverId: dare.row.serverId,
    dareId: dare.row.id,
    fromState: "active",
    toState: "voided",
    reason: input.voidReason,
    surface: input.surface,
  });
  const summary = baseSummary(dare, "voided");
  summary.potTotal = outcome.potTotal;
  summary.refunds = outcome.refunds;
  summary.voidReason = input.voidReason;
  return summary;
}
