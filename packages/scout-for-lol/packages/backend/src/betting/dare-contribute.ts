import {
  BucksStakeSchema,
  OPEN_BUCKS_DARE_STATES,
  type BucksDareState,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { ensureBucksAccount } from "#src/betting/accounts.ts";
import {
  currentDareState,
  daresFeatureEnabled,
  defaultDareDependencies,
  insufficientDareFunds,
  loadDareWithTargets,
  summarizeDare,
  type DareDomainDependencies,
} from "#src/betting/dare-common.ts";
import { stakeDareContributionInTransaction } from "#src/betting/dare-ledger.ts";
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
  | { kind: "insufficient"; balance: number; needed: number };

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
  const conditionSummary = summarizeDare(dare);

  const account = await ensureBucksAccount(
    { serverId: input.serverId, discordId: input.contributorDiscordId },
    dependencies.prismaClient,
  );

  try {
    const result = await dependencies.prismaClient.$transaction(async (tx) => {
      // Guarded first statement: claiming the dare row in a contributable
      // state both proves the pot is still open and serializes this append
      // against settlement — a losing racer matches 0 rows and reads the
      // fresh state for precise copy. `updateManyAndReturn` keeps the claim
      // and the post-increment pot read one statement.
      const claimed = await tx.bucksDare.updateManyAndReturn({
        where: {
          id: dare.id,
          dareState: { in: [...OPEN_BUCKS_DARE_STATES] },
        },
        data: { potTotal: { increment: amount }, updatedAt: now },
        select: { potTotal: true },
      });
      const updated = claimed[0];
      if (updated === undefined || claimed.length !== 1) {
        return {
          kind: "too_late",
          dareState: await currentDareState(tx, dare.id),
        } as const;
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
