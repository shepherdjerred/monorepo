import { z } from "zod";
import {
  AccountIdSchema,
  ChallengeContractV1Schema,
  ChallengeCoverageSchema,
  ChallengeProgressSchema,
  evaluateChallengeContract,
  freezeChallengeCatalogs,
  type ChallengeContractV1,
  type ChallengeEvidenceMatch,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { fetchChallengeEvidence } from "#src/progression/challenges/evidence.ts";
import type { ProgressionMatchCursor } from "#src/progression/progression-lake-reads.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PREVIEW_PAGE_SIZE = 10_000;

export const ChallengeDraftPreviewSchema = z.strictObject({
  accountIds: AccountIdSchema.array().min(1),
  progress: ChallengeProgressSchema,
  coverage: ChallengeCoverageSchema,
});

export async function getChallengeDraft(
  db: ExtendedPrismaClient,
  options: {
    readonly ownerDiscordId: DiscordAccountId;
    readonly draftId: string;
  },
) {
  const draft = await db.challengeDraft.findFirstOrThrow({
    where: {
      id: options.draftId,
      ownerDiscordId: options.ownerDiscordId,
      expiresAt: { gt: new Date() },
    },
  });
  return {
    id: draft.id,
    sourceTemplateId: draft.sourceTemplateId,
    contract: ChallengeContractV1Schema.parse(JSON.parse(draft.contractJson)),
    preview:
      draft.previewJson === null
        ? null
        : ChallengeDraftPreviewSchema.parse(JSON.parse(draft.previewJson)),
    previewedAt: draft.previewedAt?.toISOString() ?? null,
    publishedVersionId: draft.publishedVersionId,
    expiresAt: draft.expiresAt.toISOString(),
  };
}

async function ownedAccounts(
  db: ExtendedPrismaClient,
  ownerDiscordId: DiscordAccountId,
  requestedAccountIds: readonly z.infer<typeof AccountIdSchema>[],
) {
  if (new Set(requestedAccountIds).size !== requestedAccountIds.length) {
    throw new Error("A challenge preview cannot select an account twice");
  }
  const accounts = await db.account.findMany({
    where: {
      id: { in: [...requestedAccountIds] },
      player: { discordId: ownerDiscordId },
    },
  });
  if (accounts.length !== requestedAccountIds.length) {
    throw new Error(
      "Every selected Riot account must belong to the signed-in user",
    );
  }
  return accounts;
}

export async function validateChallengeDraft(
  db: ExtendedPrismaClient,
  options: {
    readonly ownerDiscordId: DiscordAccountId;
    readonly contract: ChallengeContractV1;
    readonly sourceTemplateId?: string;
  },
) {
  const contract = ChallengeContractV1Schema.parse(options.contract);
  if (options.sourceTemplateId !== undefined) {
    await db.challengeTemplate.findFirstOrThrow({
      where: {
        id: options.sourceTemplateId,
        authorDiscordId: options.ownerDiscordId,
      },
    });
  }
  const draft = await db.challengeDraft.create({
    data: {
      ownerDiscordId: options.ownerDiscordId,
      ...(options.sourceTemplateId === undefined
        ? {}
        : { sourceTemplateId: options.sourceTemplateId }),
      contractJson: JSON.stringify(contract),
      expiresAt: new Date(Date.now() + DAY_MS),
    },
  });
  return {
    draftId: draft.id,
    contract,
    canonicalRules: JSON.stringify(contract),
    explanation: contract.explanation,
    expiresAt: draft.expiresAt.toISOString(),
  };
}

export async function previewChallengeDraft(
  db: ExtendedPrismaClient,
  options: {
    readonly ownerDiscordId: DiscordAccountId;
    readonly draftId: string;
    readonly accountIds: z.infer<typeof AccountIdSchema>[];
    readonly startAt: Date;
    readonly endAt: Date;
  },
) {
  if (options.startAt >= options.endAt) {
    throw new Error("Challenge preview start must be before its end");
  }
  const [draft, accounts] = await Promise.all([
    db.challengeDraft.findFirstOrThrow({
      where: {
        id: options.draftId,
        ownerDiscordId: options.ownerDiscordId,
        expiresAt: { gt: new Date() },
      },
    }),
    ownedAccounts(db, options.ownerDiscordId, options.accountIds),
  ]);
  const contract = freezeChallengeCatalogs(
    ChallengeContractV1Schema.parse(JSON.parse(draft.contractJson)),
  );
  const evidence: ChallengeEvidenceMatch[] = [];
  let cursor: ProgressionMatchCursor | undefined;
  for (;;) {
    const page = await fetchChallengeEvidence({
      puuids: accounts.map((account) => account.puuid),
      startAt: options.startAt,
      endAt: options.endAt,
      ...(cursor === undefined ? {} : { cursor }),
      limit: PREVIEW_PAGE_SIZE,
    });
    evidence.push(...page.evidence.map((entry) => entry.match));
    if (page.rowsRead < PREVIEW_PAGE_SIZE) break;
    if (page.nextCursor === undefined) {
      throw new Error("Challenge preview page did not advance its cursor");
    }
    cursor = page.nextCursor;
  }
  const evaluated = evaluateChallengeContract(contract, evidence, {
    startAt: options.startAt.toISOString(),
    endAt: options.endAt.toISOString(),
  });
  const preview = ChallengeDraftPreviewSchema.parse({
    accountIds: options.accountIds,
    ...evaluated,
  });
  await db.challengeDraft.update({
    where: { id: draft.id },
    data: {
      // Preview and publication must share the same resolved catalogs. In
      // particular, current_champions is a moving registry: freezing only in
      // the evaluator would let a later publication resolve a different
      // target set than the one the user confirmed.
      contractJson: JSON.stringify(contract),
      previewJson: JSON.stringify(preview),
      previewedAt: new Date(),
    },
  });
  return preview;
}
