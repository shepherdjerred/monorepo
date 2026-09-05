import {
  BucksDareHorizonKindSchema,
  BucksStakeSchema,
  type BucksDareHorizonKind,
  type BucksDareState,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type PlayerId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { ensureBucksAccount } from "#src/betting/accounts.ts";
import {
  DARE_ACCEPT_WINDOW_MS,
  DARE_MAX_TARGETS,
  DARE_MAX_WINDOW_DAYS,
  DARE_PROPOSAL_TTL_MS,
} from "#src/betting/constants.ts";
import {
  currentDareState,
  daresFeatureEnabled,
  defaultDareDependencies,
  insufficientDareFunds,
  loadChallengerDare,
  summarizeDare,
  type DareDomainDependencies,
} from "#src/betting/dares/dare-common.ts";
import {
  DARE_CONDITION_VERSION,
  DARE_EVALUATOR_VERSION,
  DareConditionsSchema,
  DareTargetAccountsSchema,
  dareSemanticIssues,
  renderDareConditions,
  type DareConditions,
  type DareTargetIdentity,
} from "#src/betting/dares/evaluation/dare-criteria.ts";
import {
  DARE_CALLOUT_MAX_LENGTH,
  dareCalloutContent,
} from "#src/betting/dares/presentation/dare-copy.ts";
import { stakeDareContributionInTransaction } from "#src/betting/dares/settlement/dare-ledger.ts";
import { InsufficientBucksError } from "#src/betting/ledger.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import { bettingDaresTotal } from "#src/metrics/betting.ts";

/**
 * Creating, confirming, and abandoning a dare proposal.
 *
 * A `proposed` dare holds no money: `potTotal` records the challenger's
 * PLEDGED opening contribution, and confirming is what debits it and writes
 * the first contribution row — so the stored pot and the contribution rows
 * agree from `pending_accept` onward, which settlement asserts.
 */

export type CreateProposedDareInput = {
  serverId: DiscordGuildId;
  channelId: DiscordChannelId;
  challengerDiscordId: DiscordAccountId;
  originalText: string;
  /** The frozen model translation record, already serialized for audit. */
  translation: string | null;
  conditions: DareConditions;
  horizonKind: BucksDareHorizonKind;
  windowDays?: number | undefined;
  /** The challenger's pledged opening contribution, debited at confirm. */
  amount: number;
  targets: readonly {
    discordId: DiscordAccountId;
    playerId: PlayerId;
    alias: string;
    accounts: readonly { puuid: string; trackingStartedAt: string }[];
  }[];
};

export type CreateProposedDareResult =
  | {
      kind: "created";
      dareId: number;
      conditionSummary: string;
      proposalExpiresAt: Date;
    }
  | { kind: "feature_disabled" }
  | { kind: "invalid"; issues: string[] };

const WindowDaysSchema = z.number().int().min(1).max(DARE_MAX_WINDOW_DAYS);

function proposalIssues(input: CreateProposedDareInput): string[] {
  const issues: string[] = [];
  if (!BucksStakeSchema.safeParse(input.amount).success) {
    issues.push("The opening amount must be a positive whole number of BB");
  }
  if (input.targets.length === 0 || input.targets.length > DARE_MAX_TARGETS) {
    issues.push(
      `A dare names between 1 and ${DARE_MAX_TARGETS.toString()} targets`,
    );
  }
  if (input.horizonKind === "window") {
    if (!WindowDaysSchema.safeParse(input.windowDays).success) {
      issues.push(
        `A window dare needs between 1 and ${DARE_MAX_WINDOW_DAYS.toString()} days`,
      );
    }
  } else if (input.windowDays !== undefined) {
    issues.push("A next-game dare cannot carry a window length");
  }
  return issues;
}

/**
 * Persist a validated translation as a `proposed` dare plus frozen target
 * rows. No money moves; the ephemeral confirmation the challenger sees is
 * rendered from the same stored conditions this writes.
 */
export async function createProposedDare(
  input: CreateProposedDareInput,
  dependencies: DareDomainDependencies = defaultDareDependencies,
  now: Date = new Date(),
): Promise<CreateProposedDareResult> {
  if (!(await daresFeatureEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" };
  }
  const conditions = DareConditionsSchema.parse(input.conditions);
  const targets: DareTargetIdentity[] = input.targets.map((target) => ({
    discordId: target.discordId,
    alias: target.alias,
    accounts: DareTargetAccountsSchema.parse(target.accounts),
  }));
  const issues = [
    ...proposalIssues(input),
    ...dareSemanticIssues(targets, conditions, input.horizonKind),
  ];
  if (issues.length > 0) {
    return { kind: "invalid", issues };
  }

  const conditionSummary = renderDareConditions(
    conditions,
    targets.map((target) => target.alias),
  );
  const proposalExpiresAt = new Date(now.getTime() + DARE_PROPOSAL_TTL_MS);
  const created = await dependencies.prismaClient.bucksDare.create({
    data: {
      serverId: input.serverId,
      channelId: input.channelId,
      challengerDiscordId: input.challengerDiscordId,
      horizonKind: input.horizonKind,
      windowDays:
        input.horizonKind === "window" ? (input.windowDays ?? null) : null,
      conditions: JSON.stringify(conditions),
      conditionVersion: DARE_CONDITION_VERSION,
      evaluatorVersion: DARE_EVALUATOR_VERSION,
      originalText: input.originalText,
      translation: input.translation,
      potTotal: input.amount,
      proposalExpiresAt,
      targets: {
        create: input.targets.map((target) => ({
          discordId: target.discordId,
          playerId: target.playerId,
          alias: target.alias,
          accounts: JSON.stringify(
            DareTargetAccountsSchema.parse(target.accounts),
          ),
        })),
      },
    },
    select: { id: true },
  });

  bettingDaresTotal.inc({ result: "proposed" });
  logBucksTransition({
    event: "bucks.dare.proposed",
    serverId: input.serverId,
    dareId: created.id,
    actorDiscordId: input.challengerDiscordId,
    stake: input.amount,
    toState: "proposed",
    surface: "command",
  });
  return {
    kind: "created",
    dareId: created.id,
    conditionSummary,
    proposalExpiresAt,
  };
}

export type ConfirmDareResult =
  | {
      kind: "confirmed";
      dareId: number;
      potTotal: number;
      acceptDeadline: Date;
    }
  | { kind: "feature_disabled" }
  | { kind: "not_found" }
  | { kind: "not_challenger" }
  | { kind: "proposal_expired" }
  | { kind: "already_resolved"; dareState: BucksDareState }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "callout_too_long"; length: number };

/**
 * The challenger approves the code-rendered interpretation: debit the pledged
 * opening amount, write the first contribution row, and open the accept
 * window. Insufficient funds roll the whole transition back and leave the
 * dare `proposed`.
 */
export async function confirmDare(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
  },
  dependencies: DareDomainDependencies = defaultDareDependencies,
  now: Date = new Date(),
): Promise<ConfirmDareResult> {
  if (!(await daresFeatureEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" };
  }
  const lookup = await loadChallengerDare(dependencies.prismaClient, input);
  if (lookup.kind !== "ok") {
    return lookup;
  }
  const dare = lookup.dare;
  const amount = dare.potTotal;
  const conditionSummary = summarizeDare(dare);
  const acceptDeadline = new Date(now.getTime() + DARE_ACCEPT_WINDOW_MS);

  // Bound the callout BEFORE any money moves: the public message is
  // rendered from this same conditionSummary/target list, and a valid
  // multi-target, multi-leaf dare can push it past Discord's hard content
  // limit. Rendering the exact post-confirm state here — the same function
  // the real callout uses — means this check can never drift from what
  // would actually be sent.
  const calloutPreview = dareCalloutContent({
    dareState: "pending_accept",
    challengerDiscordId: input.challengerDiscordId,
    potTotal: amount,
    conditionSummary,
    horizonKind: BucksDareHorizonKindSchema.parse(dare.horizonKind),
    targets: dare.targets.map((target) => ({
      discordId: target.discordId,
      alias: target.alias,
      accepted: false,
      declined: false,
    })),
    acceptDeadline,
    windowEndsAt: null,
    progress: [],
  });
  if (calloutPreview.length > DARE_CALLOUT_MAX_LENGTH) {
    return { kind: "callout_too_long", length: calloutPreview.length };
  }

  // Wallet creation (and its house-funded seed grant) cannot nest inside the
  // confirm transaction, so it is ensured first — transfer precedent.
  const account = await ensureBucksAccount(
    { serverId: input.serverId, discordId: input.challengerDiscordId },
    dependencies.prismaClient,
  );

  try {
    const txResult = await dependencies.prismaClient.$transaction(
      async (tx) => {
        // Guarded first statement: only a live `proposed` dare can be
        // confirmed, and exactly once — a concurrent double-click matches 0
        // rows and re-reads for precise copy below.
        const claim = await tx.bucksDare.updateMany({
          where: {
            id: dare.id,
            dareState: "proposed",
            proposalExpiresAt: { gt: now },
          },
          data: { dareState: "pending_accept", acceptDeadline },
        });
        if (claim.count !== 1) {
          const dareState = await currentDareState(tx, dare.id);
          if (dareState === "proposed") {
            return { kind: "proposal_expired" } as const;
          }
          return { kind: "already_resolved", dareState } as const;
        }
        const balance = await stakeDareContributionInTransaction(tx, {
          facts: {
            dareId: dare.id,
            serverId: dare.serverId,
            potTotal: amount,
            targetAliases: dare.targets.map((target) => target.alias),
            conditionSummary,
          },
          bucksAccountId: account.id,
          discordId: input.challengerDiscordId,
          amount,
        });
        return { kind: "confirmed", balance } as const;
      },
    );
    if (txResult.kind !== "confirmed") {
      return txResult;
    }
    bettingDaresTotal.inc({ result: "confirmed" });
    logBucksTransition({
      event: "bucks.dare.confirmed",
      serverId: input.serverId,
      dareId: dare.id,
      actorDiscordId: input.challengerDiscordId,
      stake: amount,
      balanceAfter: txResult.balance,
      fromState: "proposed",
      toState: "pending_accept",
      surface: "button",
    });
    return {
      kind: "confirmed",
      dareId: dare.id,
      potTotal: amount,
      acceptDeadline,
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

export type AbandonDareResult =
  | { kind: "abandoned"; dareId: number }
  | { kind: "not_found" }
  | { kind: "not_challenger" }
  | { kind: "already_resolved"; dareState: BucksDareState };

/**
 * The challenger cancels their own unconfirmed proposal. No money has moved,
 * so this is a pure state transition — the proposal-TTL sweep uses the same
 * terminal state for proposals nobody answered.
 */
export async function abandonDare(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
  },
  dependencies: DareDomainDependencies = defaultDareDependencies,
): Promise<AbandonDareResult> {
  const lookup = await loadChallengerDare(dependencies.prismaClient, input);
  if (lookup.kind !== "ok") {
    return lookup;
  }
  const dare = lookup.dare;
  const claim = await dependencies.prismaClient.bucksDare.updateMany({
    where: { id: dare.id, dareState: "proposed" },
    data: { dareState: "abandoned" },
  });
  if (claim.count !== 1) {
    return {
      kind: "already_resolved",
      dareState: await currentDareState(dependencies.prismaClient, dare.id),
    };
  }
  bettingDaresTotal.inc({ result: "abandoned" });
  logBucksTransition({
    event: "bucks.dare.abandoned",
    serverId: input.serverId,
    dareId: dare.id,
    actorDiscordId: input.challengerDiscordId,
    fromState: "proposed",
    toState: "abandoned",
    surface: "button",
  });
  return { kind: "abandoned", dareId: dare.id };
}
