import {
  ChallengeContractV1Schema,
  ChallengeTemplateVersionSchema,
  WIN_EVERY_CURRENT_CHAMPION_ARENA_FIRST_TEMPLATE,
  WIN_EVERY_CURRENT_CHAMPION_ARENA_WIN_TEMPLATE,
  WIN_EVERY_CURRENT_CHAMPION_FLEX_TEMPLATE,
  WIN_EVERY_CURRENT_CHAMPION_SOLO_TEMPLATE,
  type ChallengeTemplateVersion,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { parseProgressionJson } from "#src/progression/json.ts";

const LEGACY_BUILTIN_SLUG = "scout-win-every-current-champion";

export const BUILTIN_CHALLENGE_TEMPLATES = [
  {
    slug: "scout-win-every-champion-solo",
    template: WIN_EVERY_CURRENT_CHAMPION_SOLO_TEMPLATE,
  },
  {
    slug: "scout-win-every-champion-flex",
    template: WIN_EVERY_CURRENT_CHAMPION_FLEX_TEMPLATE,
  },
  {
    slug: "scout-win-every-champion-arena-win",
    template: WIN_EVERY_CURRENT_CHAMPION_ARENA_WIN_TEMPLATE,
  },
  {
    slug: "scout-win-every-champion-arena-first",
    template: WIN_EVERY_CURRENT_CHAMPION_ARENA_FIRST_TEMPLATE,
  },
] as const;

export async function ensureBuiltInChallengeTemplates(
  db: ExtendedPrismaClient,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const legacy = await tx.challengeTemplate.findUnique({
      where: { slug: LEGACY_BUILTIN_SLUG },
      select: { id: true },
    });
    if (legacy !== null) {
      const runs = await tx.challengeRun.findMany({
        where: { templateId: legacy.id },
        select: { id: true },
      });
      const runIds = runs.map((run) => run.id);
      if (runIds.length > 0) {
        await tx.challengeActiveRun.deleteMany({
          where: { templateId: legacy.id },
        });
        await tx.challengeRunEvidence.deleteMany({
          where: { runId: { in: runIds } },
        });
        await tx.challengeRunCursor.deleteMany({
          where: { runId: { in: runIds } },
        });
        await tx.challengeRunMatchTrigger.deleteMany({
          where: { runId: { in: runIds } },
        });
        await tx.challengeRunSnapshot.deleteMany({
          where: { runId: { in: runIds } },
        });
        await tx.challengeRunRevision.deleteMany({
          where: { runId: { in: runIds } },
        });
        await tx.challengeRun.deleteMany({
          where: { id: { in: runIds } },
        });
      }
      await tx.challengeTemplateVersion.deleteMany({
        where: { templateId: legacy.id },
      });
      await tx.challengeTemplate.delete({
        where: { id: legacy.id },
      });
    }

    for (const entry of BUILTIN_CHALLENGE_TEMPLATES) {
      const template = await tx.challengeTemplate.upsert({
        where: { slug: entry.slug },
        create: {
          slug: entry.slug,
          authorDiscordId: "scout",
          latestVersion: 1,
        },
        update: {},
      });
      await tx.challengeTemplateVersion.upsert({
        where: { templateId_version: { templateId: template.id, version: 1 } },
        create: {
          templateId: template.id,
          version: 1,
          title: entry.template.title,
          summary: entry.template.summary,
          contractJson: JSON.stringify(entry.template),
          authorDiscordId: "scout",
        },
        update: {
          title: entry.template.title,
          summary: entry.template.summary,
          contractJson: JSON.stringify(entry.template),
        },
      });
    }
  });
}

function versionFromRow(row: {
  readonly id: string;
  readonly templateId: string;
  readonly version: number;
  readonly authorDiscordId: string;
  readonly contractJson: string;
  readonly publishedAt: Date;
}): ChallengeTemplateVersion {
  return ChallengeTemplateVersionSchema.parse({
    id: row.id,
    templateId: row.templateId,
    version: row.version,
    authorDiscordId: row.authorDiscordId,
    contract: parseProgressionJson(row.contractJson, ChallengeContractV1Schema),
    publishedAt: row.publishedAt.toISOString(),
  });
}

export async function searchChallengeCatalog(
  db: ExtendedPrismaClient,
  query: string | undefined,
): Promise<ChallengeTemplateVersion[]> {
  await ensureBuiltInChallengeTemplates(db);
  const templates = await db.challengeTemplate.findMany({
    where:
      query === undefined || query.trim().length === 0
        ? {}
        : {
            versions: {
              some: {
                OR: [
                  { title: { contains: query, mode: "insensitive" } },
                  { summary: { contains: query, mode: "insensitive" } },
                ],
              },
            },
          },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  return templates.flatMap((template) =>
    template.versions.map((version) => versionFromRow(version)),
  );
}

export async function getChallengeTemplate(
  db: ExtendedPrismaClient,
  templateId: string,
): Promise<ChallengeTemplateVersion[]> {
  await ensureBuiltInChallengeTemplates(db);
  const versions = await db.challengeTemplateVersion.findMany({
    where: { templateId },
    orderBy: { version: "desc" },
  });
  return versions.map((version) => versionFromRow(version));
}

export async function publishChallengeDraft(
  db: ExtendedPrismaClient,
  options: {
    readonly draftId: string;
    readonly ownerDiscordId: DiscordAccountId;
  },
): Promise<ChallengeTemplateVersion> {
  return await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-challenge-publish'), hashtext(${options.draftId}))`;
    const draft = await tx.challengeDraft.findFirst({
      where: {
        id: options.draftId,
        ownerDiscordId: options.ownerDiscordId,
        expiresAt: { gt: new Date() },
      },
    });
    if (draft === null)
      throw new Error("Challenge draft is missing or expired");
    if (draft.previewJson === null || draft.previewedAt === null) {
      throw new Error("Challenge draft must be previewed before publication");
    }
    if (draft.publishedVersionId !== null) {
      const published = await tx.challengeTemplateVersion.findUniqueOrThrow({
        where: { id: draft.publishedVersionId },
      });
      return versionFromRow(published);
    }
    const contract = parseProgressionJson(
      draft.contractJson,
      ChallengeContractV1Schema,
    );
    let template;
    if (draft.sourceTemplateId === null) {
      template = await tx.challengeTemplate.create({
        data: {
          authorDiscordId: options.ownerDiscordId,
          latestVersion: 1,
        },
      });
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-challenge-template'), hashtext(${draft.sourceTemplateId}))`;
      template = await tx.challengeTemplate.findFirstOrThrow({
        where: {
          id: draft.sourceTemplateId,
          authorDiscordId: options.ownerDiscordId,
        },
      });
    }
    const version =
      draft.sourceTemplateId === null ? 1 : template.latestVersion + 1;
    const published = await tx.challengeTemplateVersion.create({
      data: {
        templateId: template.id,
        version,
        title: contract.title,
        summary: contract.summary,
        contractJson: JSON.stringify(contract),
        authorDiscordId: options.ownerDiscordId,
      },
    });
    await tx.challengeTemplate.update({
      where: { id: template.id },
      data: { latestVersion: version },
    });
    await tx.challengeDraft.update({
      where: { id: draft.id },
      data: { publishedVersionId: published.id },
    });
    return versionFromRow(published);
  });
}
