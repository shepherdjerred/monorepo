import {
  DARE_CONTRACT_VERSION,
  DARE_CONTRACT_V3_VERSION,
  DARE_SQL_V3_EVALUATOR_VERSION,
  DareCompiledPlanV2Schema,
  DareSqlV3CompilationSchema,
  DareContractV2Schema,
  DareContractV3Schema,
  DiscordAccountIdSchema,
  PlayerIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { DARE_ACCEPT_WINDOW_MS } from "#src/betting/constants.ts";
import { pendingDareV2CalloutRefresh } from "#src/betting/dare-callout-refresh-state-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  refundDareV2ContributionsInTransaction,
  stakeDareV2ContributionInTransaction,
} from "#src/betting/dare-ledger-v2.ts";
import {
  bindDareV2Deadline,
  currentDareV2State,
  parseDareV2Deadline,
  parseDareV2Targets,
} from "#src/betting/dare-v2-common.ts";
import type { Db } from "#src/database/index.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dare-notification-outbox.ts";

function contractCompilerVersion(revision: {
  compilerVersion: string;
  scoutQlImmutableAst: string | null;
  scoutQlPlanHash: string | null;
}): "dare-scoutql-1" | "dare-scoutql-2" | "dare-sql-3" {
  if (revision.compilerVersion === "dare-scoutql-1") {
    return "dare-scoutql-1";
  }
  if (revision.compilerVersion === "dare-sql-3") {
    if (
      revision.scoutQlImmutableAst === null ||
      revision.scoutQlPlanHash === null
    ) {
      throw new Error("Dare SQL v3 revision has no immutable artifact.");
    }
    return "dare-sql-3";
  }
  if (revision.compilerVersion !== "dare-scoutql-2") {
    throw new Error(
      `Unknown Dare ScoutQL compiler ${revision.compilerVersion}.`,
    );
  }
  if (
    revision.scoutQlImmutableAst === null &&
    revision.scoutQlPlanHash === null
  ) {
    return "dare-scoutql-2";
  }
  if (
    revision.scoutQlImmutableAst === null ||
    revision.scoutQlPlanHash === null
  ) {
    throw new Error(
      "Dare ScoutQL compiler v2 revision has an incomplete immutable artifact.",
    );
  }
  return "dare-scoutql-2";
}

export async function fundDareV2InTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    bucksAccountId: number;
    now: Date;
  },
) {
  const revision = await tx.bucksDareV2Revision.findUnique({
    where: {
      dareId_revision: { dareId: input.dareId, revision: input.revision },
    },
  });
  if (revision === null) return { kind: "stale_revision" } as const;
  const targets = parseDareV2Targets(revision.targetsJson);
  const deadlineSpec = parseDareV2Deadline(revision.deadlineSpecJson);
  const absoluteDeadline =
    deadlineSpec.kind === "absolute"
      ? bindDareV2Deadline(deadlineSpec, input.now)
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
  const claimed = await tx.bucksDareV2.updateManyAndReturn({
    where: {
      id: input.dareId,
      challengerDiscordId: input.actorDiscordId,
      dareState: "draft",
      currentRevision: input.revision,
    },
    data: {
      dareState: "pending_accept",
      fundedRevision: input.revision,
      openingStake: revision.openingStake,
      potTotal: revision.openingStake,
      proposalExpiresAt: input.now,
      acceptDeadline,
      ...pendingDareV2CalloutRefresh(),
    },
    select: { id: true, serverId: true },
  });
  const dare = claimed[0];
  if (dare === undefined || claimed.length !== 1) {
    const state = await currentDareV2State(tx, input.dareId);
    return { kind: "not_fundable", dareState: state } as const;
  }
  await tx.bucksDareV2Target.createMany({
    data: targets.map((target) => ({
      dareId: dare.id,
      targetKey: target.key,
      discordId: DiscordAccountIdSchema.parse(target.discordId),
      playerId: PlayerIdSchema.parse(target.playerId),
      alias: target.alias,
      accounts: JSON.stringify(target.accounts),
    })),
  });
  const balance = await stakeDareV2ContributionInTransaction(tx, {
    facts: {
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal: revision.openingStake,
      targetAliases: targets.map((target) => target.alias),
      conditionSummary: revision.plainLanguage,
    },
    bucksAccountId: input.bucksAccountId,
    discordId: input.actorDiscordId,
    amount: revision.openingStake,
  });
  await enqueueDareNotificationInTransaction(tx, {
    dareId: dare.id,
    revision: input.revision,
    category: "lifecycle",
    kind: "funded",
    actorDiscordId: input.actorDiscordId,
    summary: `Funded for ${revision.openingStake.toString()} Bryan Bucks and awaiting target acceptance.`,
    deduplicationKey: `dare:${dare.id.toString()}:revision:${input.revision.toString()}:funded`,
    occurredAt: input.now,
  });
  return {
    kind: "funded",
    dareId: dare.id,
    revision: input.revision,
    potTotal: revision.openingStake,
    balanceAfter: balance,
    acceptDeadline,
  } as const;
}

export async function acceptDareV2InTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    bucksAccountId: number;
    now: Date;
  },
) {
  const claim = await tx.bucksDareV2.updateMany({
    where: {
      id: input.dareId,
      dareState: "pending_accept",
      fundedRevision: input.revision,
      acceptDeadline: { gt: input.now },
    },
    data: {
      updatedAt: input.now,
      ...pendingDareV2CalloutRefresh(),
    },
  });
  if (claim.count !== 1) {
    const state = await currentDareV2State(tx, input.dareId);
    return {
      kind:
        state === "pending_accept" ? "accept_window_expired" : "not_accepting",
      dareState: state,
    } as const;
  }
  const stamped = await tx.bucksDareV2Target.updateMany({
    where: {
      dareId: input.dareId,
      discordId: input.actorDiscordId,
      acceptedAt: null,
      declinedAt: null,
    },
    data: { acceptedAt: input.now, bucksAccountId: input.bucksAccountId },
  });
  if (stamped.count !== 1) return { kind: "already_answered" } as const;
  const unaccepted = await tx.bucksDareV2Target.count({
    where: { dareId: input.dareId, acceptedAt: null },
  });
  const targetCount = await tx.bucksDareV2Target.count({
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
    tx.bucksDareV2.findUniqueOrThrow({ where: { id: input.dareId } }),
    tx.bucksDareV2Revision.findUniqueOrThrow({
      where: {
        dareId_revision: { dareId: input.dareId, revision: input.revision },
      },
    }),
  ]);
  const compilerVersion = contractCompilerVersion(revision);
  const targets = parseDareV2Targets(revision.targetsJson);
  const deadlineSpec = parseDareV2Deadline(revision.deadlineSpecJson);
  const deadlineAt = bindDareV2Deadline(deadlineSpec, input.now);
  if (deadlineAt <= input.now) {
    const expired = await tx.bucksDareV2.updateMany({
      where: { id: input.dareId, dareState: "pending_accept" },
      data: {
        dareState: "expired",
        settledAt: input.now,
        ...pendingDareV2CalloutRefresh(),
      },
    });
    if (expired.count !== 1) {
      return {
        kind: "not_accepting",
        dareState: await currentDareV2State(tx, input.dareId),
      } as const;
    }
    const facts = await dareV2MoneyFactsInTransaction(tx, {
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal: dare.potTotal,
      targetAliases: targets.map((target) => target.alias),
      conditionSummary: revision.plainLanguage,
    });
    await refundDareV2ContributionsInTransaction(tx, {
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
  const sharedContract = {
    targets,
    openingStake: revision.openingStake,
    serverId: dare.serverId,
    channelId: dare.channelId,
    revision: input.revision,
    activationAt: input.now.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    deadlineSpec,
    plainLanguage: revision.plainLanguage,
  };
  const contract =
    compilerVersion === "dare-sql-3"
      ? (() => {
          const compilation = DareSqlV3CompilationSchema.parse(
            JSON.parse(revision.compiledPlan),
          );
          return DareContractV3Schema.parse({
            version: DARE_CONTRACT_V3_VERSION,
            canonicalSql: revision.canonicalScoutQl,
            immutableAst: revision.scoutQlImmutableAst,
            queryHash: revision.scoutQlPlanHash,
            maxEligibleGames: compilation.maxEligibleGames,
            compilerVersion,
            evaluatorVersion: DARE_SQL_V3_EVALUATOR_VERSION,
            finality: compilation.finality,
            facts: compilation.facts,
            resultStructure: compilation.resultStructure,
            originalText: revision.originalText,
            ...sharedContract,
          });
        })()
      : DareContractV2Schema.parse({
          version: DARE_CONTRACT_VERSION,
          canonicalScoutQl: revision.canonicalScoutQl,
          compiledPlan: DareCompiledPlanV2Schema.parse(
            JSON.parse(revision.compiledPlan),
          ),
          compilerVersion,
          evaluatorVersion: revision.evaluatorVersion,
          semanticProofPlan: revision.semanticProofPlan,
          ...sharedContract,
        });
  const activated = await tx.bucksDareV2.updateMany({
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
      `Dare v2 ${input.dareId.toString()} lost its activation claim.`,
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
