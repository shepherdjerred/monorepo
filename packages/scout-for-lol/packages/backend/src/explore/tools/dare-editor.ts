import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  StorableDareChallengerStakeSchema,
  DareDeadlineSpecSchema,
  DareTargetBindingSchema,
  DARE_MAX_QUERY_LENGTH,
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  prepareDareDraft,
  retainedDareDraftSemantics,
  reviseDareDraft,
} from "#src/betting/dares/lifecycle/dare-draft.ts";
import { renderDareSqlSemanticProofPlan } from "#src/betting/dares/sql/dare-sql-description.ts";
import { prisma } from "#src/database/index.ts";
import { parseStoredStatusPhrases } from "#src/betting/dares/presentation/dare-list-copy.ts";

export const DareDraftEditorInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  originalText: z.string().min(1).max(4000),
  plainLanguage: z.string().min(1).max(4000),
  queryText: z.string().min(1).max(DARE_MAX_QUERY_LENGTH),
  deadlineSpec: DareDeadlineSpecSchema,
  openingStake: StorableDareChallengerStakeSchema,
});

export const DareDraftPreviewInputSchema = DareDraftEditorInputSchema.extend({
  historyDays: z.number().int().min(1).max(90).default(30),
});

type EditorInput = z.infer<typeof DareDraftEditorInputSchema>;

async function loadOwnedDraft(input: {
  dareId: number;
  expectedRevision: number;
  userId: DiscordAccountId;
  guildIds: DiscordGuildId[];
}) {
  const dare = await prisma.bucksDare.findFirst({
    where: {
      id: input.dareId,
      challengerDiscordId: input.userId,
      serverId: { in: input.guildIds },
      dareState: "draft",
    },
    include: {
      revisions: {
        where: { revision: input.expectedRevision },
        take: 1,
      },
    },
  });
  if (dare === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
  }
  if (dare.currentRevision !== input.expectedRevision) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Draft is now revision ${dare.currentRevision.toString()}.`,
    });
  }
  const revision = dare.revisions[0];
  if (revision === undefined) {
    throw new Error(
      `Dare ${dare.id.toString()} is missing its current revision.`,
    );
  }
  return {
    dare,
    revision,
    targets: DareTargetBindingSchema.array().parse(
      JSON.parse(revision.targetsJson),
    ),
  };
}

function retainedListCopy(revision: {
  displayTitle: string | null;
  statusPhrasesJson: string | null;
}) {
  const statusPhrases = parseStoredStatusPhrases(revision.statusPhrasesJson);
  return {
    ...(revision.displayTitle === null
      ? {}
      : { displayTitle: revision.displayTitle }),
    ...(statusPhrases === null ? {} : { statusPhrases }),
  };
}

function contractDefinition(
  input: EditorInput,
  owned: Awaited<ReturnType<typeof loadOwnedDraft>>,
) {
  return {
    originalText: input.originalText,
    ...retainedListCopy(owned.revision),
    queryText: input.queryText,
    plainLanguage: input.plainLanguage,
    targets: owned.targets,
    deadlineSpec: input.deadlineSpec,
    openingStake: input.openingStake,
    ...retainedDareDraftSemantics(owned.revision.compiledPlan),
  };
}

export async function validateDareDraftEditor(
  input: EditorInput,
  userId: DiscordAccountId,
  guildIds: DiscordGuildId[],
) {
  const owned = await loadOwnedDraft({
    dareId: input.dareId,
    expectedRevision: input.expectedRevision,
    userId,
    guildIds,
  });
  const prepared = await prepareDareDraft(contractDefinition(input, owned));
  return prepared.kind === "invalid"
    ? { kind: "invalid" as const, issues: prepared.issues }
    : {
        kind: "valid" as const,
        canonicalScoutQl: prepared.draft.compilation.canonicalSql,
        scoutQlPlanHash: prepared.draft.compilation.queryHash,
        scoutQlFacts: prepared.draft.compilation.facts,
        plainLanguage: prepared.draft.plainLanguage,
        semanticProofPlan: renderDareSqlSemanticProofPlan(
          prepared.draft.compilation,
        ),
      };
}

export async function previewDareDraftEditor(
  input: z.infer<typeof DareDraftPreviewInputSchema>,
  userId: DiscordAccountId,
  guildIds: DiscordGuildId[],
) {
  const ownedDraft = await loadOwnedDraft({
    dareId: input.dareId,
    expectedRevision: input.expectedRevision,
    userId,
    guildIds,
  });
  const prepared = await prepareDareDraft({
    ...contractDefinition(input, ownedDraft),
    historyDays: input.historyDays,
  });
  if (prepared.kind === "invalid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: prepared.issues.join(" "),
    });
  }
  return {
    achieved: prepared.draft.preview.achieved,
    eligibleGames: prepared.draft.preview.sourceMatchIds.length,
    coverageComplete: prepared.draft.preview.coverage !== "missing_timeline",
  };
}

export async function reviseDareDraftEditor(
  input: EditorInput,
  userId: DiscordAccountId,
  guildIds: DiscordGuildId[],
) {
  const ownedDraft = await loadOwnedDraft({
    dareId: input.dareId,
    expectedRevision: input.expectedRevision,
    userId,
    guildIds,
  });
  return await reviseDareDraft({
    dareId: input.dareId,
    serverId: DiscordGuildIdSchema.parse(ownedDraft.dare.serverId),
    challengerDiscordId: userId,
    expectedRevision: input.expectedRevision,
    definition: contractDefinition(input, ownedDraft),
  });
}
