import {
  DareActivationSnapshotSchema,
  DareSqlCompilationSchema,
  RegionSchema,
  rankForQueue,
  rankToLeaguePoints,
  type DareActivationSnapshot,
  type DareSqlCompilation,
  type DareTargetBinding,
  type Rank,
} from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { buildDareContract } from "#src/betting/dares/evaluation/dare-contract-build.ts";
import { improvementBaselineSnapshot } from "#src/betting/dares/lifecycle/dare-activation-evaluation.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import { executeDareSql } from "#src/betting/dares/sql/dare-sql.ts";
import { parseDareTargets } from "#src/betting/dares/dare-common.ts";
import { voidDareWithFullRefund } from "#src/betting/dares/settlement/dare-void.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";

const ACTIVATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_RETRY_MS = 5 * 60 * 1000;

type ActivatingRow = Prisma.BucksDareGetPayload<{
  include: {
    targets: true;
    activation: true;
    revisions: true;
  };
}>;

export type DareActivationDependencies = {
  prismaClient: ExtendedPrismaClient;
  getRank: typeof getRankByPuuid;
  executeSql: typeof executeDareSql;
  clock: () => Date;
};

const DEFAULT_DEPENDENCIES: DareActivationDependencies = {
  prismaClient: prisma,
  getRank: getRankByPuuid,
  executeSql: executeDareSql,
  clock: () => new Date(),
};

class TransientActivationError extends Error {}
class UnrankedActivationError extends Error {}
class InsufficientBaselineError extends Error {}

function compilationFor(row: ActivatingRow) {
  const revision = row.revisions.find(
    (candidate) => candidate.revision === row.fundedRevision,
  );
  if (revision === undefined) {
    throw new Error(
      `Activating Dare ${row.id.toString()} is missing its funded revision.`,
    );
  }
  return {
    revision,
    compilation: DareSqlCompilationSchema.parse(
      JSON.parse(revision.compiledPlan),
    ),
    targets: parseDareTargets(revision.targetsJson),
  };
}

function storedRanks(ranks: {
  solo?: Rank | undefined;
  flex?: Rank | undefined;
  ranked5s?: Rank | undefined;
}) {
  return {
    soloRank: ranks.solo === undefined ? null : JSON.stringify(ranks.solo),
    flexRank: ranks.flex === undefined ? null : JSON.stringify(ranks.flex),
    ranked5sRank:
      ranks.ranked5s === undefined ? null : JSON.stringify(ranks.ranked5s),
  };
}

type SnapshotInput = {
  row: ActivatingRow;
  compilation: DareSqlCompilation;
  targets: DareTargetBinding[];
  dependencies: DareActivationDependencies;
  now: Date;
};

async function rankSnapshot(
  input: SnapshotInput,
): Promise<DareActivationSnapshot> {
  const { row, compilation, targets, dependencies, now } = input;
  if (compilation.activation.kind !== "rank") {
    throw new Error("Rank snapshot requested for a non-rank activation.");
  }
  const frozenPuuids = targets.flatMap((target) =>
    target.accounts.map((account) => account.puuid),
  );
  const accounts = await dependencies.prismaClient.account.findMany({
    where: {
      serverId: row.serverId,
      playerId: { in: targets.map((target) => target.playerId) },
      puuid: { in: frozenPuuids },
    },
    select: { playerId: true, puuid: true, region: true },
  });
  const snapshots: DareActivationSnapshot["targets"] = [];
  for (const target of targets) {
    const targetPuuids = new Set(
      target.accounts.map((account) => account.puuid),
    );
    const targetAccounts = accounts.filter(
      (account) =>
        account.playerId === target.playerId && targetPuuids.has(account.puuid),
    );
    if (targetAccounts.length === 0) {
      throw new Error(`Target ${target.key} has no persisted Riot account.`);
    }
    const ranked: { rank: Rank; puuid: string }[] = [];
    for (const account of targetAccounts) {
      const result = await dependencies.getRank(
        account.puuid,
        RegionSchema.parse(account.region),
      );
      if (result.status === "error") {
        throw new TransientActivationError(
          `Riot rank lookup failed for ${target.key}.`,
        );
      }
      await dependencies.prismaClient.currentRankSnapshot.upsert({
        where: { puuid: account.puuid },
        create: {
          puuid: account.puuid,
          ...storedRanks(result.ranks),
          fetchedAt: now,
        },
        update: { ...storedRanks(result.ranks), fetchedAt: now },
      });
      const rank = rankForQueue(result.ranks, compilation.activation.queue);
      if (rank !== undefined) ranked.push({ rank, puuid: account.puuid });
    }
    const best = ranked.toSorted(
      (left, right) =>
        rankToLeaguePoints(right.rank) - rankToLeaguePoints(left.rank),
    )[0];
    if (best === undefined) {
      throw new UnrankedActivationError(
        `${target.alias} is unranked in ${compilation.activation.queue}.`,
      );
    }
    snapshots.push({
      kind: "rank",
      targetKey: target.key,
      queue: compilation.activation.queue,
      sourcePuuid: best.puuid,
      baseline: best.rank,
    });
  }
  return DareActivationSnapshotSchema.parse({
    version: 1,
    activatedAt: now.toISOString(),
    targets: snapshots,
  });
}

async function improvementSnapshot(
  compilation: DareSqlCompilation,
  targets: DareTargetBinding[],
  dependencies: DareActivationDependencies,
  now: Date,
): Promise<DareActivationSnapshot> {
  if (compilation.activation.kind !== "improvement") {
    throw new Error("Improvement snapshot requested for another activation.");
  }
  const activation = compilation.activation;
  const start = new Date(
    activation.window.kind === "last_days"
      ? now.getTime() - activation.window.days * 24 * 60 * 60 * 1000
      : 0,
  );
  const evidence = await dependencies.executeSql({
    compilation,
    targets,
    start,
    end: now,
    matchOrder: activation.window.kind === "last_games" ? "newest" : "oldest",
  });
  try {
    if (
      activation.window.kind === "last_days" &&
      evidence.sourceMatchIds.length >= compilation.maxEligibleGames
    ) {
      throw new InsufficientBaselineError(
        "The requested day window reaches the compiled eligible-game cap.",
      );
    }
    return improvementBaselineSnapshot({ activation, evidence, now });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("timeline coverage is incomplete")
    ) {
      throw new TransientActivationError(error.message);
    }
    if (
      error instanceof Error &&
      error.message.includes("does not have enough complete samples")
    ) {
      throw new InsufficientBaselineError(error.message);
    }
    throw error;
  }
}

async function buildSnapshot(input: SnapshotInput) {
  const { compilation, targets, dependencies, now } = input;
  if (compilation.activation.kind === "immediate") {
    throw new Error("Immediate Dare was incorrectly enqueued for activation.");
  }
  return compilation.activation.kind === "rank"
    ? await rankSnapshot(input)
    : await improvementSnapshot(compilation, targets, dependencies, now);
}

async function activateOne(
  row: ActivatingRow,
  dependencies: DareActivationDependencies,
  now: Date,
): Promise<"activated" | "voided" | "retrying"> {
  const job = row.activation;
  if (job === null)
    throw new Error(`Dare ${row.id.toString()} has no activation job.`);
  if (now.getTime() - job.requestedAt.getTime() >= ACTIVATION_TIMEOUT_MS) {
    await voidDareWithFullRefund(
      row,
      "activation_timeout",
      dependencies.prismaClient,
      { now },
    );
    return "voided";
  }
  const { revision, compilation, targets } = compilationFor(row);
  await dependencies.prismaClient.bucksDareActivation.update({
    where: { dareId: row.id },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
      errorCode: null,
    },
  });
  try {
    const snapshot = await buildSnapshot({
      row,
      compilation,
      targets,
      dependencies,
      now,
    });
    const activationAt = dependencies.clock();
    const built = buildDareContract({
      dare: row,
      revision,
      targets,
      activationAt,
      activationSnapshot: snapshot,
    });
    if (built.deadlineAt <= activationAt) {
      await voidDareWithFullRefund(
        row,
        "activation_timeout",
        dependencies.prismaClient,
        { now },
      );
      return "voided";
    }
    return await dependencies.prismaClient.$transaction(
      async (tx): Promise<"activated"> => {
        const claim = await tx.bucksDare.updateMany({
          where: { id: row.id, dareState: "activating" },
          data: {
            dareState: "active",
            activatedAt: activationAt,
            deadlineAt: built.deadlineAt,
            contractJson: JSON.stringify(built.contract),
            ...pendingDareCalloutRefresh(),
          },
        });
        if (claim.count !== 1) return "activated";
        await tx.bucksDareActivation.update({
          where: { dareId: row.id },
          data: {
            snapshotJson: JSON.stringify(snapshot),
            completedAt: activationAt,
          },
        });
        await enqueueDareNotificationInTransaction(tx, {
          dareId: row.id,
          revision: revision.revision,
          category: "lifecycle",
          kind: "activated",
          summary: `The activation snapshot is frozen; the Dare is active until ${built.deadlineAt.toISOString()}.`,
          deduplicationKey: `dare:${row.id.toString()}:revision:${revision.revision.toString()}:activated`,
          occurredAt: activationAt,
        });
        return "activated";
      },
    );
  } catch (error) {
    if (error instanceof UnrankedActivationError) {
      await voidDareWithFullRefund(
        row,
        "target_unavailable",
        dependencies.prismaClient,
        { now },
      );
      return "voided";
    }
    if (error instanceof InsufficientBaselineError) {
      await voidDareWithFullRefund(
        row,
        "insufficient_baseline",
        dependencies.prismaClient,
        { now },
      );
      return "voided";
    }
    await dependencies.prismaClient.bucksDareActivation.update({
      where: { dareId: row.id },
      data: {
        errorCode:
          error instanceof TransientActivationError
            ? "source_unavailable"
            : "activation_failed",
        nextAttemptAt: new Date(now.getTime() + ACTIVATION_RETRY_MS),
      },
    });
    if (error instanceof TransientActivationError) return "retrying";
    throw error;
  }
}

export async function activatePendingDares(
  dependencies: DareActivationDependencies = DEFAULT_DEPENDENCIES,
  now: Date = new Date(),
): Promise<{ activated: number; voided: number; retrying: number }> {
  const rows = await dependencies.prismaClient.bucksDare.findMany({
    where: {
      dareState: "activating",
      activation: { completedAt: null, nextAttemptAt: { lte: now } },
    },
    include: {
      targets: { orderBy: { id: "asc" } },
      activation: true,
      revisions: { orderBy: { revision: "asc" } },
    },
    orderBy: { id: "asc" },
  });
  let activated = 0;
  let voided = 0;
  let retrying = 0;
  const failures: unknown[] = [];
  for (const row of rows) {
    try {
      const result = await activateOne(row, dependencies, now);
      if (result === "activated") activated += 1;
      else if (result === "voided") voided += 1;
      else retrying += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length.toString()} Dare activations failed.`,
    );
  }
  return { activated, voided, retrying };
}
