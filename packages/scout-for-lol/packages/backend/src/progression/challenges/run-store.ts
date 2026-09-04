import { z } from "zod";
import {
  AccountIdSchema,
  ChallengeContractV1Schema,
  ChallengeCoverageSchema,
  ChallengeProgressSchema,
  ChallengeRunStatusSchema,
  LeaguePuuidSchema,
  freezeChallengeCatalogs,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  scoutChallengeRunRecomputeWorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import { parseProgressionJson } from "#src/progression/json.ts";
import { fetchProgressionMatches } from "#src/progression/progression-lake-reads.ts";

export const ChallengeSelectedAccountSchema = z.strictObject({
  accountId: AccountIdSchema,
  puuid: LeaguePuuidSchema,
  alias: z.string().min(1),
});
export const ChallengeSelectedAccountsSchema =
  ChallengeSelectedAccountSchema.array().min(1);

async function lockChallengeTemplate(
  tx: Db,
  templateId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "ChallengeTemplate" WHERE "id" = ${templateId} FOR UPDATE`;
}

async function selectOwnedAccounts(
  db: ExtendedPrismaClient,
  ownerDiscordId: DiscordAccountId,
  accountIds: readonly z.infer<typeof AccountIdSchema>[],
) {
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error("A challenge run cannot select an account twice");
  }
  const accounts = await db.account.findMany({
    where: {
      id: { in: [...accountIds] },
      player: { discordId: ownerDiscordId },
    },
  });
  if (accounts.length !== accountIds.length) {
    throw new Error(
      "Every selected Riot account must belong to the signed-in user",
    );
  }
  return ChallengeSelectedAccountsSchema.parse(
    accounts.map((account) => ({
      accountId: account.id,
      puuid: account.puuid,
      alias: account.alias,
    })),
  );
}

async function earliestKnownMatch(
  puuids: string[],
  fallback: Date,
): Promise<Date> {
  const rows = await fetchProgressionMatches({
    puuids,
    startAt: new Date(0),
    limit: 1,
  });
  const earliest = rows[0];
  return earliest === undefined ? fallback : new Date(earliest.game_end_ms);
}

function runSnapshotFromRow(row: {
  readonly progressJson: string;
  readonly coverageJson: string;
  readonly evaluatedThroughAt: Date | null;
  readonly completedAt: Date | null;
  readonly revision: number;
}) {
  return {
    revision: row.revision,
    progress: parseProgressionJson(row.progressJson, ChallengeProgressSchema),
    coverage: parseProgressionJson(row.coverageJson, ChallengeCoverageSchema),
    evaluatedThroughAt: row.evaluatedThroughAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function startChallengeRun(
  db: ExtendedPrismaClient,
  options: {
    readonly ownerDiscordId: DiscordAccountId;
    readonly templateId: string;
    readonly accountIds: z.infer<typeof AccountIdSchema>[];
    readonly mode:
      | { readonly kind: "clean_slate" }
      | { readonly kind: "import"; readonly startAt: Date }
      | { readonly kind: "earliest_known" };
    readonly stage: ScoutStage;
  },
) {
  const accounts = await selectOwnedAccounts(
    db,
    options.ownerDiscordId,
    options.accountIds,
  );
  const version = await db.challengeTemplateVersion.findFirstOrThrow({
    where: { templateId: options.templateId },
    orderBy: { version: "desc" },
  });
  const now = new Date();
  const startAt =
    options.mode.kind === "clean_slate"
      ? now
      : options.mode.kind === "import"
        ? options.mode.startAt
        : await earliestKnownMatch(
            accounts.map((account) => account.puuid),
            now,
          );
  if (startAt > now)
    throw new Error("Challenge runs cannot start in the future");
  const contract = freezeChallengeCatalogs(
    parseProgressionJson(version.contractJson, ChallengeContractV1Schema),
  );
  return await db.$transaction(async (tx) => {
    await lockChallengeTemplate(tx, options.templateId);
    await tx.challengeRun.updateMany({
      where: {
        ownerDiscordId: options.ownerDiscordId,
        templateId: options.templateId,
        runState: { not: "archived" },
      },
      data: { runState: "archived", archivedAt: now, recomputing: false },
    });
    await tx.challengeActiveRun.deleteMany({
      where: {
        ownerDiscordId: options.ownerDiscordId,
        templateId: options.templateId,
      },
    });
    const run = await tx.challengeRun.create({
      data: {
        ownerDiscordId: options.ownerDiscordId,
        templateId: options.templateId,
        templateVersionId: version.id,
        originalStartAt: startAt,
        importRequestedAt:
          options.mode.kind === "clean_slate" ? null : new Date(),
        frozenContractJson: JSON.stringify(contract),
        runState: "active",
      },
    });
    const revision = 1;
    const workflowId = scoutChallengeRunRecomputeWorkflowId(
      options.stage,
      run.id,
      revision,
    );
    await tx.challengeRunRevision.create({
      data: {
        runId: run.id,
        revision,
        selectedAccountsJson: JSON.stringify(accounts),
        workflowId,
      },
    });
    await tx.challengeActiveRun.create({
      data: {
        ownerDiscordId: options.ownerDiscordId,
        templateId: options.templateId,
        runId: run.id,
      },
    });
    return { runId: run.id, revision, workflowId };
  });
}

export async function changeChallengeRunAccounts(
  db: ExtendedPrismaClient,
  options: {
    readonly ownerDiscordId: DiscordAccountId;
    readonly runId: string;
    readonly accountIds: z.infer<typeof AccountIdSchema>[];
    readonly stage: ScoutStage;
  },
) {
  const accounts = await selectOwnedAccounts(
    db,
    options.ownerDiscordId,
    options.accountIds,
  );
  return await db.$transaction(async (tx) => {
    const runReference = await tx.challengeRun.findFirstOrThrow({
      where: { id: options.runId, ownerDiscordId: options.ownerDiscordId },
      select: { templateId: true },
    });
    await lockChallengeTemplate(tx, runReference.templateId);
    await tx.$executeRaw`SELECT 1 FROM "ChallengeRun" WHERE "id" = ${options.runId} FOR UPDATE`;
    const run = await tx.challengeRun.findFirstOrThrow({
      where: { id: options.runId, ownerDiscordId: options.ownerDiscordId },
    });
    if (run.runState === "archived") {
      throw new Error("Archived challenge runs cannot be changed");
    }
    const current = await tx.challengeRun.findFirst({
      where: {
        ownerDiscordId: options.ownerDiscordId,
        templateId: run.templateId,
        runState: { not: "archived" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (current?.id !== run.id) {
      throw new Error("Historical challenge runs cannot be changed");
    }
    const revision = run.evaluationRevision + 1;
    const workflowId = scoutChallengeRunRecomputeWorkflowId(
      options.stage,
      run.id,
      revision,
    );
    await tx.challengeRun.update({
      where: { id: run.id },
      data: {
        evaluationRevision: revision,
        recomputing: true,
        runState: "active",
        completedAt: null,
      },
    });
    await tx.challengeRunRevision.create({
      data: {
        runId: run.id,
        revision,
        selectedAccountsJson: JSON.stringify(accounts),
        workflowId,
      },
    });
    await tx.challengeActiveRun.upsert({
      where: {
        ownerDiscordId_templateId: {
          ownerDiscordId: options.ownerDiscordId,
          templateId: run.templateId,
        },
      },
      create: {
        ownerDiscordId: options.ownerDiscordId,
        templateId: run.templateId,
        runId: run.id,
      },
      update: { runId: run.id },
    });
    return { runId: run.id, revision, workflowId };
  });
}

export async function getChallengeRun(db: ExtendedPrismaClient, runId: string) {
  const run = await db.challengeRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      templateVersion: true,
      revisions: { orderBy: { revision: "desc" } },
      snapshots: { orderBy: { revision: "desc" } },
    },
  });
  const current = run.snapshots.find(
    (snapshot) => snapshot.id === run.currentSnapshotId,
  );
  return {
    id: run.id,
    templateId: run.templateId,
    templateVersionId: run.templateVersionId,
    title: run.templateVersion.title,
    summary: run.templateVersion.summary,
    status: ChallengeRunStatusSchema.parse(run.runState),
    originalStartAt: run.originalStartAt.toISOString(),
    recomputing: run.recomputing,
    evaluationRevision: run.evaluationRevision,
    currentSnapshot: current === undefined ? null : runSnapshotFromRow(current),
    revisions: run.revisions.map((revision) => ({
      revision: revision.revision,
      state: revision.revisionState,
      errorMessage: revision.errorMessage,
      accounts: parseProgressionJson(
        revision.selectedAccountsJson,
        ChallengeSelectedAccountsSchema,
      ),
      createdAt: revision.createdAt.toISOString(),
    })),
    history: run.snapshots.map((snapshot) => runSnapshotFromRow(snapshot)),
  };
}

export async function getChallengeRunHistory(
  db: ExtendedPrismaClient,
  ownerDiscordId: DiscordAccountId,
) {
  const runs = await db.challengeRun.findMany({
    where: { ownerDiscordId },
    orderBy: { createdAt: "desc" },
    include: { templateVersion: true },
  });
  return runs.map((run) => ({
    id: run.id,
    templateId: run.templateId,
    title: run.templateVersion.title,
    status: ChallengeRunStatusSchema.parse(run.runState),
    recomputing: run.recomputing,
    originalStartAt: run.originalStartAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    archivedAt: run.archivedAt?.toISOString() ?? null,
  }));
}
