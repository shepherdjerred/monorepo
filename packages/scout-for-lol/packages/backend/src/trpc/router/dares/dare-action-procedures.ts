import { assertDaresScope } from "#src/consumer/dares-access.ts";
import { deleteDareDraft } from "#src/dares/lifecycle/dare-draft.ts";
import { consumeDareConfirmationIntent } from "#src/dares/lifecycle/dare-intent-consume.ts";
import {
  createDareConfirmationIntent,
  dareIntentAction,
} from "#src/dares/lifecycle/dare-intent.ts";
import { tryEnsureDareCallout } from "#src/dares/presentation/dare-callout.ts";
import { listDareEvidence } from "#src/dares/presentation/dare-evidence-view.ts";
import { prisma } from "#src/database/index.ts";
import { webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import {
  DareIntentPayloadSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const DareInput = GuildInput.extend({ dareId: z.number().int().positive() });
const DareEvidenceInput = DareInput.extend({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});
const DarePrepareActionInput = DareInput.extend({
  expectedRevision: z.number().int().positive(),
  payload: DareIntentPayloadSchema,
  idempotencyKey: z.uuid(),
});
const DareConfirmActionInput = GuildInput.extend({ intentId: z.uuid() });
const DareDeleteDraftInput = DareInput.extend({
  expectedRevision: z.number().int().positive(),
});

export const dareActionProcedures = {
  dareEvidence: webProcedure
    .input(DareEvidenceInput)
    .query(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const page = await listDareEvidence(
        {
          dareId: input.dareId,
          serverId: input.guildId,
          viewerDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
        prisma,
      );
      if (page === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dare not found." });
      }
      return page;
    }),

  darePrepareAction: webMutationProcedure
    .input(DarePrepareActionInput)
    .mutation(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const outcome = await createDareConfirmationIntent({
        dareId: input.dareId,
        serverId: input.guildId,
        actorDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        expectedRevision: input.expectedRevision,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
      });
      if (outcome.kind !== "intent_created") return outcome;
      const dare = await prisma.dare.findUniqueOrThrow({
        where: { id: input.dareId },
        select: {
          targets: { orderBy: { id: "asc" }, select: { alias: true } },
        },
      });
      const action = dareIntentAction(input.payload.kind);
      return {
        ...outcome,
        confirmation: {
          action,
          targets: dare.targets.map((target) => target.alias),
          irreversible: ["publish", "accept"].includes(action),
        },
      };
    }),

  dareConfirmAction: webMutationProcedure
    .input(DareConfirmActionInput)
    .mutation(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const intent = await prisma.confirmationIntent.findUnique({
        where: { id: input.intentId },
        select: { dareId: true },
      });
      const outcome = await consumeDareConfirmationIntent({
        intentId: input.intentId,
        serverId: input.guildId,
        actorDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
      });
      const failed = [
        "not_found",
        "forbidden",
        "intent_expired",
        "feature_disabled",
      ].includes(outcome.kind);
      const dareId = intent?.dareId ?? null;
      const callout =
        dareId === null || failed ? null : await tryEnsureDareCallout(dareId);
      return { ...outcome, callout };
    }),

  dareDeleteDraft: webMutationProcedure
    .input(DareDeleteDraftInput)
    .mutation(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      return await deleteDareDraft({
        dareId: input.dareId,
        serverId: input.guildId,
        challengerDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        expectedRevision: input.expectedRevision,
      });
    }),
};
