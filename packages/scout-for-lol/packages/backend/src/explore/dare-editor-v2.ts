import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  BucksStakeSchema,
  DareDeadlineSpecV2Schema,
  DareTargetBindingV2Schema,
  DARE_V2_MAX_QUERY_LENGTH,
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  prepareDareDraftV3,
  retainedDareDraftV3Semantics,
  reviseDareDraftV3,
} from "#src/betting/dare-draft-v3.ts";
import {
  prepareDareDraftV2,
  reviseDareDraftV2,
} from "#src/betting/dare-draft-v2.ts";
import { historicallyPreviewDareV2 } from "#src/betting/dare-preview-v2.ts";
import { compileDareScoutQlPlanV2 } from "#src/betting/dare-scoutql-plan-compiler-v2.ts";
import { renderDareSqlV3SemanticProofPlan } from "#src/betting/dare-sql-v3-description.ts";
import { prisma } from "#src/database/index.ts";

export const DareDraftEditorInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  originalText: z.string().min(1).max(4000),
  plainLanguage: z.string().min(1).max(4000),
  queryText: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
});

export const DareDraftPreviewInputSchema = DareDraftEditorInputSchema.extend({
  historyDays: z.number().int().min(1).max(90).default(30),
});

type EditorInput = z.infer<typeof DareDraftEditorInputSchema>;

async function loadOwnedDraft(input: {
  dareId: number;
  expectedRevision: number;
  userId: DiscordAccountId;
  guildIds: string[];
}) {
  const dare = await prisma.bucksDareV2.findFirst({
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
      `Dare v2 ${dare.id.toString()} is missing its current revision.`,
    );
  }
  return {
    dare,
    revision,
    targets: DareTargetBindingV2Schema.array().parse(
      JSON.parse(revision.targetsJson),
    ),
  };
}

function v3Definition(
  input: EditorInput,
  owned: Awaited<ReturnType<typeof loadOwnedDraft>>,
) {
  return {
    originalText: input.originalText,
    queryText: input.queryText,
    plainLanguage: input.plainLanguage,
    targets: owned.targets,
    deadlineSpec: input.deadlineSpec,
    openingStake: input.openingStake,
    ...retainedDareDraftV3Semantics(owned.revision.compiledPlan),
  };
}

async function prepareEditorDraft(
  input: EditorInput,
  userId: DiscordAccountId,
  guildIds: string[],
) {
  const owned = await loadOwnedDraft({
    dareId: input.dareId,
    expectedRevision: input.expectedRevision,
    userId,
    guildIds,
  });
  const compilation = await compileDareScoutQlPlanV2({
    queryText: input.queryText,
    targets: owned.targets,
  });
  if (compilation.kind === "invalid") {
    return { kind: "invalid" as const, owned, issues: compilation.issues };
  }
  return {
    kind: "valid" as const,
    owned,
    compilation: compilation.compilation,
    prepared: prepareDareDraftV2({
      originalText: input.originalText,
      plan: compilation.compilation.plan,
      targets: owned.targets,
      deadlineSpec: input.deadlineSpec,
      openingStake: input.openingStake,
    }),
  };
}

async function prepareValidEditorDraft(
  input: EditorInput,
  userId: DiscordAccountId,
  guildIds: string[],
) {
  const result = await prepareEditorDraft(input, userId, guildIds);
  if (result.kind === "invalid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.issues.join(" "),
    });
  }
  if (result.prepared.kind === "invalid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.prepared.issues.join(" "),
    });
  }
  return {
    owned: result.owned,
    prepared: result.prepared,
  };
}

export async function validateDareDraftEditorV2(
  input: EditorInput,
  userId: DiscordAccountId,
  guildIds: string[],
) {
  const owned = await loadOwnedDraft({
    dareId: input.dareId,
    expectedRevision: input.expectedRevision,
    userId,
    guildIds,
  });
  if (owned.revision.compilerVersion === "dare-scoutql-3") {
    const prepared = await prepareDareDraftV3(v3Definition(input, owned));
    return prepared.kind === "invalid"
      ? { kind: "invalid" as const, issues: prepared.issues }
      : {
          kind: "valid" as const,
          canonicalScoutQl: prepared.draft.compilation.canonicalSql,
          scoutQlPlanHash: prepared.draft.compilation.queryHash,
          scoutQlFacts: prepared.draft.compilation.facts,
          plainLanguage: prepared.draft.plainLanguage,
          semanticProofPlan: renderDareSqlV3SemanticProofPlan(
            prepared.draft.compilation,
          ),
        };
  }
  const result = await prepareEditorDraft(input, userId, guildIds);
  if (result.kind === "invalid") {
    return { kind: "invalid" as const, issues: result.issues };
  }
  const { prepared } = result;
  return prepared.kind === "invalid"
    ? { kind: "invalid" as const, issues: prepared.issues }
    : {
        kind: "valid" as const,
        canonicalScoutQl: prepared.draft.canonicalScoutQl,
        scoutQlPlanHash: result.compilation.planHash,
        scoutQlFacts: result.compilation.facts,
        plainLanguage: prepared.draft.plainLanguage,
        semanticProofPlan: prepared.draft.semanticProofPlan,
      };
}

export async function previewDareDraftEditorV2(
  input: z.infer<typeof DareDraftPreviewInputSchema>,
  userId: DiscordAccountId,
  guildIds: string[],
) {
  const ownedDraft = await loadOwnedDraft({
    dareId: input.dareId,
    expectedRevision: input.expectedRevision,
    userId,
    guildIds,
  });
  if (ownedDraft.revision.compilerVersion === "dare-scoutql-3") {
    const prepared = await prepareDareDraftV3({
      ...v3Definition(input, ownedDraft),
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
  const { owned, prepared } = await prepareValidEditorDraft(
    input,
    userId,
    guildIds,
  );
  const end = new Date();
  return await historicallyPreviewDareV2({
    plan: prepared.draft.plan,
    targets: owned.targets,
    start: new Date(end.getTime() - input.historyDays * 24 * 60 * 60 * 1000),
    end,
  });
}

export async function reviseDareDraftEditorV2(
  input: EditorInput,
  userId: DiscordAccountId,
  guildIds: string[],
) {
  const ownedDraft = await loadOwnedDraft({
    dareId: input.dareId,
    expectedRevision: input.expectedRevision,
    userId,
    guildIds,
  });
  if (ownedDraft.revision.compilerVersion === "dare-scoutql-3") {
    return await reviseDareDraftV3({
      dareId: input.dareId,
      serverId: DiscordGuildIdSchema.parse(ownedDraft.dare.serverId),
      challengerDiscordId: userId,
      expectedRevision: input.expectedRevision,
      definition: v3Definition(input, ownedDraft),
    });
  }
  const { owned, prepared } = await prepareValidEditorDraft(
    input,
    userId,
    guildIds,
  );
  return await reviseDareDraftV2({
    dareId: input.dareId,
    serverId: DiscordGuildIdSchema.parse(owned.dare.serverId),
    challengerDiscordId: userId,
    expectedRevision: input.expectedRevision,
    definition: {
      originalText: input.originalText,
      plan: prepared.draft.plan,
      targets: prepared.draft.targets,
      deadlineSpec: prepared.draft.deadlineSpec,
      openingStake: prepared.draft.openingStake,
    },
  });
}
