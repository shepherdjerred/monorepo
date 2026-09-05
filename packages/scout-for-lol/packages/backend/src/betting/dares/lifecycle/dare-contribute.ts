import {
  BUCKS_INT32_MAX,
  BucksStakeSchema,
  BucksDareStateSchema,
  OPEN_BUCKS_DARE_STATES,
  type BucksDareState,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { ensureBucksAccount } from "#src/betting/accounts.ts";
import {
  daresFeatureEnabled,
  defaultDareDependencies,
  insufficientDareFunds,
  loadDareWithTargets,
  summarizeDare,
  type DareDomainDependencies,
} from "#src/betting/dares/dare-common.ts";
import { stakeDareContributionInTransaction } from "#src/betting/dares/settlement/dare-ledger.ts";
import { InsufficientBucksError } from "#src/betting/ledger.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import { bettingDareContributionsTotal } from "#src/metrics/betting.ts";

/**
 * Piling Bucks onto a dare's pot.
 *
 * Contributions are append-only and never retracted; they stay open for the
 * dare's whole life (`pending_accept` and `active`) because a one-sided
 * bounty has no contributor upside and therefore no information asymmetry to
 * close a window against. Targets are barred — a target funding their own
 * bounty is a pure transfer to the house.
 */

export type ContributeToDareResult =
  | {
      kind: "contributed";
      dareId: number;
      amount: number;
      potTotal: number;
      balanceAfter: number;
    }
  | { kind: "feature_disabled" }
  | { kind: "invalid_amount" }
  | { kind: "not_found" }
  | { kind: "target_cannot_contribute" }
  | { kind: "too_late"; dareState: BucksDareState }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "pot_full"; potTotal: number };

export async function contributeToDare(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    contributorDiscordId: DiscordAccountId;
    amount: number;
  },
  dependencies: DareDomainDependencies = defaultDareDependencies,
  now: Date = new Date(),
): Promise<ContributeToDareResult> {
  if (!(await daresFeatureEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" };
  }
  const amountResult = BucksStakeSchema.safeParse(input.amount);
  if (!amountResult.success) {
    return { kind: "invalid_amount" };
  }
  const amount = amountResult.data;

  const dare = await loadDareWithTargets(
    dependencies.prismaClient,
    input.dareId,
    input.serverId,
  );
  if (dare === undefined) {
    return { kind: "not_found" };
  }
  if (
    dare.targets.some(
      (target) => target.discordId === input.contributorDiscordId,
    )
  ) {
    return { kind: "target_cannot_contribute" };
  }
  // A cheap fast-path rejection using the pre-transaction read — refuses the
  // common case (a pot already visibly near the ceiling) before even
  // provisioning the contributor's wallet. This is advisory only: the WHERE
  // clause below is what actually enforces the ceiling atomically against a
  // racing contribution, since two contributions can both pass this check
  // against the same stale `dare.potTotal` and only one may actually fit.
  if (dare.potTotal + amount > BUCKS_INT32_MAX) {
    return { kind: "pot_full", potTotal: dare.potTotal };
  }

  const conditionSummary = summarizeDare(dare);

  const account = await ensureBucksAccount(
    { serverId: input.serverId, discordId: input.contributorDiscordId },
    dependencies.prismaClient,
  );

  try {
    const result = await dependencies.prismaClient.$transaction(async (tx) => {
      // Guarded first statement: claiming the dare row in a contributable
      // state, WITH the pot ceiling folded into the same WHERE, both proves
      // the pot is still open and serializes this append against settlement
      // AND every other racing contribution — a losing racer (wrong state
      // or a pot that would overflow) matches 0 rows and reads the fresh
      // state for precise copy. `updateManyAndReturn` keeps the claim and
      // the post-increment pot read one statement, so the increment itself
      // can never be attempted against a pot it would overflow: Postgres
      // evaluates the WHERE against the current row before applying the
      // increment, and a second racing contribution reading the same
      // pre-transaction potTotal cannot both win this claim.
      const claimed = await tx.bucksDare.updateManyAndReturn({
        where: {
          id: dare.id,
          dareState: { in: [...OPEN_BUCKS_DARE_STATES] },
          potTotal: { lte: BUCKS_INT32_MAX - amount },
        },
        data: { potTotal: { increment: amount }, updatedAt: now },
        select: { potTotal: true },
      });
      const updated = claimed[0];
      if (updated === undefined || claimed.length !== 1) {
        // One read settles both possible misses: the fresh state tells us
        // whether the pot is still open at all, and — only when it is —
        // whether this miss was the ceiling rather than a state change.
        const fresh = await tx.bucksDare.findUniqueOrThrow({
          where: { id: dare.id },
          select: { dareState: true, potTotal: true },
        });
        const freshState = BucksDareStateSchema.parse(fresh.dareState);
        if (
          OPEN_BUCKS_DARE_STATES.includes(freshState) &&
          fresh.potTotal + amount > BUCKS_INT32_MAX
        ) {
          return { kind: "pot_full", potTotal: fresh.potTotal } as const;
        }
        return { kind: "too_late", dareState: freshState } as const;
      }
      const balance = await stakeDareContributionInTransaction(tx, {
        facts: {
          dareId: dare.id,
          serverId: dare.serverId,
          potTotal: updated.potTotal,
          targetAliases: dare.targets.map((target) => target.alias),
          conditionSummary,
        },
        bucksAccountId: account.id,
        discordId: input.contributorDiscordId,
        amount,
      });
      return {
        kind: "contributed",
        potTotal: updated.potTotal,
        balance,
      } as const;
    });
    if (result.kind !== "contributed") {
      return result;
    }
    bettingDareContributionsTotal.inc();
    logBucksTransition({
      event: "bucks.dare.contributed",
      serverId: input.serverId,
      dareId: dare.id,
      actorDiscordId: input.contributorDiscordId,
      stake: amount,
      balanceAfter: result.balance,
      surface: "button",
    });
    return {
      kind: "contributed",
      dareId: dare.id,
      amount,
      potTotal: result.potTotal,
      balanceAfter: result.balance,
    };
  } catch (error) {
    if (error instanceof InsufficientBucksError) {
      return await insufficientDareFunds(
        dependencies.prismaClient,
        account.id,
        amount,
      );
    }
    throw error;
  }
}
