import {
  BucksDareHorizonKindSchema,
  type BucksDareHorizonKind,
  type BucksDareState,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { ensureBucksAccount } from "#src/betting/accounts.ts";
import { DARE_NEXT_GAME_TIMEOUT_MS } from "#src/betting/constants.ts";
import {
  currentDareState,
  daresFeatureEnabled,
  defaultDareDependencies,
  loadTargetDare,
  summarizeDareBestEffort,
  type DareDomainDependencies,
  type LoadedDare,
} from "#src/betting/dare-common.ts";
import {
  dareMoneyFactsInTransaction,
  refundDareContributionsInTransaction,
  type DareContributorRefund,
} from "#src/betting/dare-ledger.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import {
  bettingDareSettlementsTotal,
  bettingDaresTotal,
} from "#src/metrics/betting.ts";

/**
 * Target consent: accepting a dare, and chickening out of one.
 *
 * Accepting risks nothing — it only stamps consent and binds the wallet the
 * pot would pay. Declining is UNGATED by feature flags on purpose: it is a
 * refund path, and revoking the flag must never strand escrowed
 * contributions behind a target who wants out.
 */

export type AcceptDareResult =
  | {
      kind: "accepted";
      dareId: number;
      activated: boolean;
      acceptedCount: number;
      targetCount: number;
      horizonKind: BucksDareHorizonKind;
      windowEndsAt: Date | undefined;
    }
  | { kind: "feature_disabled" }
  | { kind: "not_found" }
  | { kind: "not_a_target" }
  | { kind: "already_accepted" }
  | { kind: "accept_window_expired" }
  | { kind: "already_resolved"; dareState: BucksDareState };

function activationWindowEnd(dare: LoadedDare, now: Date): Date {
  if (dare.horizonKind === "window") {
    if (dare.windowDays === null) {
      throw new Error(
        `Window dare ${dare.id.toString()} has no stored window length`,
      );
    }
    return new Date(now.getTime() + dare.windowDays * 24 * 60 * 60 * 1000);
  }
  return new Date(now.getTime() + DARE_NEXT_GAME_TIMEOUT_MS);
}

/**
 * One listed target accepts. The dare-row claim serializes concurrent
 * accepts (and the decline below), the guarded target stamp makes each
 * target's accept exactly-once, and the Nth accept flips the dare `active`
 * and starts its clock.
 */
export async function acceptDare(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    targetDiscordId: DiscordAccountId;
  },
  dependencies: DareDomainDependencies = defaultDareDependencies,
  now: Date = new Date(),
): Promise<AcceptDareResult> {
  if (!(await daresFeatureEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" };
  }
  const lookup = await loadTargetDare(dependencies.prismaClient, input);
  if (lookup.kind !== "ok") {
    return lookup;
  }
  const { dare, target } = lookup;

  // Wallet ensured before the transaction — accepting binds the payee wallet,
  // and the seed grant cannot nest inside the accept claim.
  const account = await ensureBucksAccount(
    { serverId: input.serverId, discordId: input.targetDiscordId },
    dependencies.prismaClient,
  );

  const result = await dependencies.prismaClient.$transaction(async (tx) => {
    // Guarded first statement: the dare-row claim serializes every accept —
    // the accepted-count read below is only safe behind this row lock.
    const claim = await tx.bucksDare.updateMany({
      where: {
        id: dare.id,
        dareState: "pending_accept",
        acceptDeadline: { gt: now },
      },
      data: { updatedAt: now },
    });
    if (claim.count !== 1) {
      const dareState = await currentDareState(tx, dare.id);
      if (dareState === "pending_accept") {
        return { kind: "accept_window_expired" } as const;
      }
      return { kind: "already_resolved", dareState } as const;
    }
    const stamp = await tx.bucksDareTarget.updateMany({
      where: { id: target.id, acceptedAt: null },
      data: { acceptedAt: now, bucksAccountId: account.id },
    });
    if (stamp.count !== 1) {
      return { kind: "already_accepted" } as const;
    }
    const unaccepted = await tx.bucksDareTarget.count({
      where: { dareId: dare.id, acceptedAt: null },
    });
    if (unaccepted > 0) {
      return {
        kind: "accepted",
        activated: false,
        acceptedCount: dare.targets.length - unaccepted,
        windowEndsAt: undefined,
      } as const;
    }
    const windowEndsAt = activationWindowEnd(dare, now);
    await tx.bucksDare.updateMany({
      where: { id: dare.id, dareState: "pending_accept" },
      data: { dareState: "active", activatedAt: now, windowEndsAt },
    });
    return {
      kind: "accepted",
      activated: true,
      acceptedCount: dare.targets.length,
      windowEndsAt,
    } as const;
  });

  if (result.kind !== "accepted") {
    return result;
  }
  bettingDaresTotal.inc({ result: "accepted" });
  logBucksTransition({
    event: "bucks.dare.accepted",
    serverId: input.serverId,
    dareId: dare.id,
    actorDiscordId: input.targetDiscordId,
    surface: "button",
  });
  if (result.activated) {
    bettingDaresTotal.inc({ result: "activated" });
    logBucksTransition({
      event: "bucks.dare.activated",
      serverId: input.serverId,
      dareId: dare.id,
      fromState: "pending_accept",
      toState: "active",
      surface: "button",
    });
  }
  return {
    kind: "accepted",
    dareId: dare.id,
    activated: result.activated,
    acceptedCount: result.acceptedCount,
    targetCount: dare.targets.length,
    horizonKind: BucksDareHorizonKindSchema.parse(dare.horizonKind),
    windowEndsAt: result.windowEndsAt,
  };
}

export type DeclineDareResult =
  | {
      kind: "declined";
      dareId: number;
      potTotal: number;
      refunds: DareContributorRefund[];
    }
  | { kind: "not_found" }
  | { kind: "not_a_target" }
  | { kind: "already_accepted" }
  | { kind: "already_resolved"; dareState: BucksDareState };

/** Thrown inside the decline transaction when the target turns out to have
 * accepted concurrently; rolls the whole decline back. */
class DareDeclineRaceError extends Error {
  constructor() {
    super("Dare target accepted while the decline was in flight");
    this.name = "DareDeclineRaceError";
  }
}

/**
 * A listed target chickens out. UNGATED: this cancels the dare and refunds
 * every contributor in full, no cut — the void-refund precedent. A target
 * who already accepted cannot retract.
 */
export async function declineDare(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    targetDiscordId: DiscordAccountId;
  },
  dependencies: DareDomainDependencies = defaultDareDependencies,
  now: Date = new Date(),
): Promise<DeclineDareResult> {
  const lookup = await loadTargetDare(dependencies.prismaClient, input);
  if (lookup.kind !== "ok") {
    return lookup;
  }
  const { dare, target } = lookup;
  // Best-effort: declining is a refund path and must never be blocked by a
  // stored conditions blob the current schema cannot parse (display-only).
  const conditionSummary = summarizeDareBestEffort(dare);

  try {
    const result = await dependencies.prismaClient.$transaction(async (tx) => {
      // Guarded first statement: only a dare still awaiting consent can be
      // chickened out of, exactly once.
      const claim = await tx.bucksDare.updateMany({
        where: { id: dare.id, dareState: "pending_accept" },
        data: { dareState: "declined", settledAt: now },
      });
      if (claim.count !== 1) {
        return {
          kind: "already_resolved",
          dareState: await currentDareState(tx, dare.id),
        } as const;
      }
      // The pre-transaction read can be stale: if this target accepted while
      // we were loading, the guarded stamp misses and the decline must not
      // stand. Throwing rolls the claim back too.
      const stamp = await tx.bucksDareTarget.updateMany({
        where: { id: target.id, acceptedAt: null, declinedAt: null },
        data: { declinedAt: now },
      });
      if (stamp.count !== 1) {
        throw new DareDeclineRaceError();
      }
      // Money facts re-read AFTER the claim: a contribution can commit
      // between the lookup above and this transaction, and the stale
      // potTotal would fail conservation against the fresh contribution rows.
      const facts = await dareMoneyFactsInTransaction(tx, {
        dareId: dare.id,
        serverId: dare.serverId,
        potTotal: dare.potTotal,
        targetAliases: dare.targets.map((row) => row.alias),
        conditionSummary,
      });
      const refunds = await refundDareContributionsInTransaction(tx, {
        facts,
        resolution: "declined",
        withCut: false,
      });
      return { kind: "declined", refunds, potTotal: facts.potTotal } as const;
    });
    if (result.kind !== "declined") {
      return result;
    }
    bettingDaresTotal.inc({ result: "declined" });
    bettingDareSettlementsTotal.inc({ outcome: "declined" });
    logBucksTransition({
      event: "bucks.dare.declined",
      serverId: input.serverId,
      dareId: dare.id,
      actorDiscordId: input.targetDiscordId,
      payout: result.potTotal,
      fromState: "pending_accept",
      toState: "declined",
      surface: "button",
    });
    return {
      kind: "declined",
      dareId: dare.id,
      potTotal: result.potTotal,
      refunds: result.refunds,
    };
  } catch (error) {
    if (error instanceof DareDeclineRaceError) {
      return { kind: "already_accepted" };
    }
    throw error;
  }
}
