import {
  DARE_SQL_COMPILER_VERSION,
  DareChallengerStakeSchema,
  darePotOf,
  DareSqlCompilationSchema,
  DiscordAccountIdSchema,
  PlayerIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { DARE_ACCEPT_WINDOW_MS } from "#src/betting/constants.ts";
import { dareSqlDomainIssues } from "#src/betting/dares/sql/dare-sql-domains.ts";
import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import {
  dareMoneyFactsInTransaction,
  refundDareContributionsInTransaction,
  stakeDareContributionInTransaction,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import {
  bindDareDeadline,
  currentDareState,
  parseDareDeadline,
  parseDareTargets,
} from "#src/betting/dares/dare-common.ts";
import type { Db } from "#src/database/index.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import { buildDareContract } from "#src/betting/dares/evaluation/dare-contract-build.ts";

/**
 * The revision's frozen compilation, refusing anything but the one contract
 * dialect Scout evaluates. A revision written by a retired compiler is a broken
 * contract here, not a Dare to fund or activate under different semantics.
 */
function requireCurrentDialect(revision: {
  dareId: number;
  compilerVersion: string;
  scoutQlImmutableAst: string | null;
  scoutQlPlanHash: string | null;
}): { immutableAst: string } {
  if (revision.compilerVersion !== DARE_SQL_COMPILER_VERSION) {
    throw new Error(
      `Dare ${revision.dareId.toString()} revision uses retired compiler ${revision.compilerVersion}.`,
    );
  }
  if (
    revision.scoutQlImmutableAst === null ||
    revision.scoutQlPlanHash === null
  ) {
    throw new Error(
      `Dare ${revision.dareId.toString()} revision has no immutable SQL artifact.`,
    );
  }
  return { immutableAst: revision.scoutQlImmutableAst };
}

export async function fundDareInTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    bucksAccountId: number;
    now: Date;
  },
) {
  const revision = await tx.bucksDareRevision.findUnique({
    where: {
      dareId_revision: { dareId: input.dareId, revision: input.revision },
    },
  });
  if (revision === null) return { kind: "stale_revision" } as const;
  // Draft-to-funded is the last moment a contract can still be fixed, and the
  // only place the domain rules can still be applied to a draft that predates
  // them: activation re-runs no compiler, so a stale draft holding a value the
  // allowlist now refuses would otherwise take a stake and settle as a real
  // loss.
  const contractIssues = dareSqlDomainIssues(
    requireCurrentDialect(revision).immutableAst,
  );
  if (contractIssues.length > 0) {
    return { kind: "contract_invalid", issues: contractIssues } as const;
  }
  const targets = parseDareTargets(revision.targetsJson);
  const deadlineSpec = parseDareDeadline(revision.deadlineSpecJson);
  const absoluteDeadline =
    deadlineSpec.kind === "absolute"
      ? bindDareDeadline(deadlineSpec, input.now)
      : null;
  if (absoluteDeadline !== null && absoluteDeadline <= input.now) {
    return { kind: "deadline_expired" } as const;
  }
  const defaultAcceptDeadline = new Date(
    input.now.getTime() + DARE_ACCEPT_WINDOW_MS,
  );
  const acceptDeadline =
    absoluteDeadline !== null && absoluteDeadline < defaultAcceptDeadline
      ? absoluteDeadline
      : defaultAcceptDeadline;
  const openingStake = DareChallengerStakeSchema.parse(revision.openingStake);
  const potTotal = darePotOf(openingStake);
  const claimed = await tx.bucksDare.updateManyAndReturn({
    where: {
      id: input.dareId,
      challengerDiscordId: input.actorDiscordId,
      dareState: "draft",
      currentRevision: input.revision,
    },
    data: {
      dareState: "pending_accept",
      fundedRevision: input.revision,
      openingStake,
      potTotal,
      proposalExpiresAt: input.now,
      acceptDeadline,
      ...pendingDareCalloutRefresh(),
    },
    select: { id: true, serverId: true },
  });
  const dare = claimed[0];
  if (dare === undefined || claimed.length !== 1) {
    const state = await currentDareState(tx, input.dareId);
    return { kind: "not_fundable", dareState: state } as const;
  }
  await tx.bucksDareTarget.createMany({
    data: targets.map((target) => ({
      dareId: dare.id,
      targetKey: target.key,
      discordId: DiscordAccountIdSchema.parse(target.discordId),
      playerId: PlayerIdSchema.parse(target.playerId),
      alias: target.alias,
      accounts: JSON.stringify(target.accounts),
    })),
  });
  const balance = await stakeDareContributionInTransaction(tx, {
    facts: {
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal,
      targetAliases: targets.map((target) => target.alias),
      conditionSummary: revision.plainLanguage,
    },
    bucksAccountId: input.bucksAccountId,
    discordId: input.actorDiscordId,
    amount: openingStake,
  });
  await enqueueDareNotificationInTransaction(tx, {
    dareId: dare.id,
    revision: input.revision,
    category: "lifecycle",
    kind: "funded",
    actorDiscordId: input.actorDiscordId,
    summary: `Funded for ${openingStake.toString()} Bryan Bucks and awaiting target acceptance.`,
    deduplicationKey: `dare:${dare.id.toString()}:revision:${input.revision.toString()}:funded`,
    occurredAt: input.now,
  });
  return {
    kind: "funded",
    dareId: dare.id,
    revision: input.revision,
    potTotal,
    balanceAfter: balance,
    acceptDeadline,
  } as const;
}

export async function acceptDareInTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    bucksAccountId: number;
    now: Date;
  },
) {
  const claim = await tx.bucksDare.updateMany({
    where: {
      id: input.dareId,
      dareState: "pending_accept",
      fundedRevision: input.revision,
      acceptDeadline: { gt: input.now },
    },
    data: {
      updatedAt: input.now,
      ...pendingDareCalloutRefresh(),
    },
  });
  if (claim.count !== 1) {
    const state = await currentDareState(tx, input.dareId);
    return {
      kind:
        state === "pending_accept" ? "accept_window_expired" : "not_accepting",
      dareState: state,
    } as const;
  }
  const stamped = await tx.bucksDareTarget.updateMany({
    where: {
      dareId: input.dareId,
      discordId: input.actorDiscordId,
      acceptedAt: null,
      declinedAt: null,
    },
    data: { acceptedAt: input.now, bucksAccountId: input.bucksAccountId },
  });
  if (stamped.count !== 1) return { kind: "already_answered" } as const;
  const unaccepted = await tx.bucksDareTarget.count({
    where: { dareId: input.dareId, acceptedAt: null },
  });
  const targetCount = await tx.bucksDareTarget.count({
    where: { dareId: input.dareId },
  });
  if (unaccepted > 0) {
    await enqueueDareNotificationInTransaction(tx, {
      dareId: input.dareId,
      revision: input.revision,
      category: "lifecycle",
      kind: "accepted",
      actorDiscordId: input.actorDiscordId,
      summary: `${(targetCount - unaccepted).toString()} of ${targetCount.toString()} targets have accepted.`,
      deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:accepted:${input.actorDiscordId}`,
      occurredAt: input.now,
    });
    return {
      kind: "accepted",
      activated: false,
      acceptedCount: targetCount - unaccepted,
      targetCount,
    } as const;
  }
  const [dare, revision] = await Promise.all([
    tx.bucksDare.findUniqueOrThrow({ where: { id: input.dareId } }),
    tx.bucksDareRevision.findUniqueOrThrow({
      where: {
        dareId_revision: { dareId: input.dareId, revision: input.revision },
      },
    }),
  ]);
  requireCurrentDialect(revision);
  const targets = parseDareTargets(revision.targetsJson);
  const deadlineSpec = parseDareDeadline(revision.deadlineSpecJson);
  const deadlineAt = bindDareDeadline(deadlineSpec, input.now);
  if (deadlineAt <= input.now) {
    const expired = await tx.bucksDare.updateMany({
      where: { id: input.dareId, dareState: "pending_accept" },
      data: {
        dareState: "expired",
        settledAt: input.now,
        ...pendingDareCalloutRefresh(),
      },
    });
    if (expired.count !== 1) {
      return {
        kind: "not_accepting",
        dareState: await currentDareState(tx, input.dareId),
      } as const;
    }
    const facts = await dareMoneyFactsInTransaction(tx, {
      dareId: dare.id,
      serverId: dare.serverId,
      targetAliases: targets.map((target) => target.alias),
      conditionSummary: revision.plainLanguage,
    });
    await refundDareContributionsInTransaction(tx, {
      facts,
      resolution: "expired",
      withCut: false,
    });
    await enqueueDareNotificationInTransaction(tx, {
      dareId: input.dareId,
      revision: input.revision,
      category: "lifecycle",
      kind: "expired",
      actorDiscordId: input.actorDiscordId,
      summary: `The acceptance window expired; ${facts.potTotal.toString()} Bryan Bucks were fully refunded.`,
      deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:expired`,
      occurredAt: input.now,
    });
    return { kind: "accept_window_expired", dareState: "expired" } as const;
  }
  const compilation = DareSqlCompilationSchema.parse(
    JSON.parse(revision.compiledPlan),
  );
  if (compilation.activation.kind !== "immediate") {
    const activating = await tx.bucksDare.updateMany({
      where: { id: input.dareId, dareState: "pending_accept" },
      data: {
        dareState: "activating",
        activatedAt: null,
        deadlineAt: null,
        contractJson: null,
        ...pendingDareCalloutRefresh(),
      },
    });
    if (activating.count !== 1) {
      throw new Error(
        `Dare ${input.dareId.toString()} lost its activation enqueue claim.`,
      );
    }
    await tx.bucksDareActivation.create({
      data: {
        dareId: input.dareId,
        revision: input.revision,
        requestedAt: input.now,
        nextAttemptAt: input.now,
      },
    });
    await enqueueDareNotificationInTransaction(tx, {
      dareId: input.dareId,
      revision: input.revision,
      category: "lifecycle",
      kind: "accepted",
      actorDiscordId: input.actorDiscordId,
      summary: `All ${targetCount.toString()} targets accepted; Scout is freezing the activation snapshot.`,
      deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:accepted:${input.actorDiscordId}`,
      occurredAt: input.now,
    });
    return {
      kind: "accepted",
      activated: false,
      acceptedCount: targetCount,
      targetCount,
    } as const;
  }
  const { contract } = buildDareContract({
    dare,
    revision,
    targets,
    activationAt: input.now,
    activationSnapshot: null,
  });
  const activated = await tx.bucksDare.updateMany({
    where: { id: input.dareId, dareState: "pending_accept" },
    data: {
      dareState: "active",
      activatedAt: input.now,
      deadlineAt,
      contractJson: JSON.stringify(contract),
    },
  });
  if (activated.count !== 1) {
    throw new Error(
      `Dare ${input.dareId.toString()} lost its activation claim.`,
    );
  }
  await enqueueDareNotificationInTransaction(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "lifecycle",
    kind: "accepted",
    actorDiscordId: input.actorDiscordId,
    summary: `All ${targetCount.toString()} targets accepted.`,
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:accepted:${input.actorDiscordId}`,
    occurredAt: input.now,
  });
  await enqueueDareNotificationInTransaction(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "lifecycle",
    kind: "activated",
    actorDiscordId: input.actorDiscordId,
    summary: `The Dare is active until ${deadlineAt.toISOString()}.`,
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:activated`,
    occurredAt: input.now,
  });
  return {
    kind: "accepted",
    activated: true,
    acceptedCount: targetCount,
    targetCount,
    deadlineAt,
  } as const;
}
