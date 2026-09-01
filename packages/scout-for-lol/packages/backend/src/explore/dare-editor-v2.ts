import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  BucksStakeSchema,
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
  DareTargetBindingV2Schema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  prepareDareDraftV2,
  reviseDareDraftV2,
} from "#src/betting/dare-draft-v2.ts";
import { historicallyPreviewDareV2 } from "#src/betting/dare-preview-v2.ts";
import { prisma } from "#src/database/index.ts";

export const DareDraftEditorInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  originalText: z.string().min(1).max(4000),
  plan: DareCompiledPlanV2Schema,
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
    targets: DareTargetBindingV2Schema.array().parse(
      JSON.parse(revision.targetsJson),
    ),
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
  return {
    owned,
    prepared: prepareDareDraftV2({
      originalText: input.originalText,
      plan: input.plan,
      targets: owned.targets,
      deadlineSpec: input.deadlineSpec,
      openingStake: input.openingStake,
    }),
  };
}

export async function validateDareDraftEditorV2(
  input: EditorInput,
  userId: DiscordAccountId,
  guildIds: string[],
) {
  const { prepared } = await prepareEditorDraft(input, userId, guildIds);
  return prepared.kind === "invalid"
    ? { kind: "invalid" as const, issues: prepared.issues }
    : {
        kind: "valid" as const,
        canonicalScoutQl: prepared.draft.canonicalScoutQl,
        plainLanguage: prepared.draft.plainLanguage,
        semanticProofPlan: prepared.draft.semanticProofPlan,
      };
}

export async function previewDareDraftEditorV2(
  input: z.infer<typeof DareDraftPreviewInputSchema>,
  userId: DiscordAccountId,
  guildIds: string[],
) {
  const { owned, prepared } = await prepareEditorDraft(input, userId, guildIds);
  if (prepared.kind === "invalid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: prepared.issues.join(" "),
    });
  }
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
  const { owned, prepared } = await prepareEditorDraft(input, userId, guildIds);
  if (prepared.kind === "invalid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: prepared.issues.join(" "),
    });
  }
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
