import {
  DARE_CONTRACT_VERSION,
  DareStoredPlanV2Schema,
  DareSqlV3CompilationSchema,
  DareCompiledPlanV2Schema,
  DareContractV2Schema,
  DiscordAccountIdSchema,
  PlayerIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { DARE_ACCEPT_WINDOW_MS } from "#src/betting/constants.ts";
import { dareSqlV3DomainIssues } from "#src/betting/dare-sql-v3-domains.ts";
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
import { buildDareContractV3 } from "#src/betting/dare-contract-v3-build.ts";

function contractCompilerVersion(revision: {
  compilerVersion: string;
  scoutQlImmutableAst: string | null;
  scoutQlPlanHash: string | null;
}): "dare-scoutql-1" | "dare-scoutql-2" | "dare-scoutql-3" {
  if (revision.compilerVersion === "dare-scoutql-1") {
    return "dare-scoutql-1";
  }
  if (revision.compilerVersion === "dare-scoutql-3") {
    if (
      revision.scoutQlImmutableAst === null ||
      revision.scoutQlPlanHash === null
    ) {
      throw new Error("Dare SQL v3 revision has no immutable artifact.");
    }
    return "dare-scoutql-3";
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

/**
 * Domain problems that must stop a draft before it takes a stake.
 *
 * Draft-to-funded is the last moment a contract can still be fixed. Authoring
 * enforces the value domains while stored plans read permissively so an
 * already-funded dare stays readable — which leaves this transition as the only
 * place a draft written before a rule existed can still be caught. Both contract
 * versions need it: v3's domain check lives in its compiler, which is a drafting
 * step, and activation re-runs neither.
 */
function fundingContractIssues(revision: {
  compilerVersion: string;
  compiledPlan: string;
  scoutQlImmutableAst: string | null;
}): string[] {
  if (revision.compilerVersion === "dare-scoutql-3") {
    return revision.scoutQlImmutableAst === null
      ? []
      : dareSqlV3DomainIssues(revision.scoutQlImmutableAst);
  }
  const authored = DareCompiledPlanV2Schema.safeParse(
    JSON.parse(revision.compiledPlan),
  );
  return authored.success
    ? []
    : authored.error.issues.map((issue) => issue.message);
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
  // Draft-to-funded is the last moment a contract can still be fixed, and the
  // only place the authoring rules can still be applied to a draft that predates
  // them. Activation deliberately parses with the permissive stored schema so an
  // already-funded dare stays readable, and this transition is what would
  // otherwise let a stale draft holding a value the allowlist now refuses take a
  // stake and settle as a real loss.
  const contractIssues = fundingContractIssues(revision);
  if (contractIssues.length > 0) {
    return { kind: "contract_invalid", issues: contractIssues } as const;
  }
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
      contractVersion: revision.compilerVersion === "dare-scoutql-3" ? 3 : 2,
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
      contractVersion: 2,
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
  const v3Compilation =
    compilerVersion === "dare-scoutql-3"
      ? DareSqlV3CompilationSchema.parse(JSON.parse(revision.compiledPlan))
      : null;
  if (v3Compilation !== null && v3Compilation.activation.kind !== "immediate") {
    const activating = await tx.bucksDareV2.updateMany({
      where: { id: input.dareId, dareState: "pending_accept" },
      data: {
        dareState: "activating",
        activatedAt: null,
        deadlineAt: null,
        contractJson: null,
        ...pendingDareV2CalloutRefresh(),
      },
    });
    if (activating.count !== 1) {
      throw new Error(
        `Dare v3 ${input.dareId.toString()} lost its activation enqueue claim.`,
      );
    }
    await tx.bucksDareV2Activation.create({
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
  const contract =
    compilerVersion === "dare-scoutql-3"
      ? buildDareContractV3({
          dare,
          revision,
          targets,
          activationAt: input.now,
          activationSnapshot: null,
        }).contract
      : DareContractV2Schema.parse({
          version: DARE_CONTRACT_VERSION,
          canonicalScoutQl: revision.canonicalScoutQl,
          compiledPlan: DareStoredPlanV2Schema.parse(
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
