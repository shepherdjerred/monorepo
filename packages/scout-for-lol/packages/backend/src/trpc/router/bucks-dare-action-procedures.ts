import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  BucksStakeSchema,
  DareIntentPayloadSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { tryEnsureDareV2Callout } from "#src/betting/dare-callout-v2.ts";
import { deleteDareDraftV2 } from "#src/betting/dare-draft-v2.ts";
import { listDareEvidenceV2 } from "#src/betting/dare-evidence-view-v2.ts";
import { consumeDareV2ConfirmationIntent } from "#src/betting/dare-intent-consume-v2.ts";
import {
  createDareV2ConfirmationIntent,
  dareV2IntentAction,
} from "#src/betting/dare-intent-v2.ts";
import { assertBucksScope } from "#src/consumer/bucks-access.ts";
import { prisma } from "#src/database/index.ts";
import { webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";

/**
 * Dare action payloads accepted from the management app.
 *
 * Confirmation intents used to discriminate on `action` (`{action: "fund"}`)
 * and now discriminate on `kind`. A tab loaded before that deployment is still
 * running the old client, so rejecting its shape would take every Dare action
 * in that tab out of service until the user happened to reload. Both shapes
 * are accepted for one release; delete the legacy branch after stale clients
 * have aged out.
 *
 * The new shape is tried first, and the legacy objects are strict, so this
 * widens what is accepted without loosening validation of either form.
 */
const LEGACY_ACTION_KINDS = {
  fund: "dare_fund",
  accept: "dare_accept",
  decline: "dare_decline",
  cancel: "dare_cancel",
  contribute: "dare_contribute",
} as const;

const LegacyDarePayloadSchema = z
  .union([
    z.strictObject({
      action: z.enum(["fund", "accept", "decline", "cancel"]),
    }),
    z.strictObject({
      action: z.literal("contribute"),
      amount: BucksStakeSchema,
    }),
  ])
  .transform((legacy) =>
    legacy.action === "contribute"
      ? { kind: LEGACY_ACTION_KINDS.contribute, amount: legacy.amount }
      : { kind: LEGACY_ACTION_KINDS[legacy.action] },
  );

// Deliberately the dare-only union, not the full confirmation-intent one: a
// creation payload accepted here would mint a creation intent through the dare
// prepare procedure and skip the creation gate entirely.
export const DarePayloadInputSchema = z.union([
  DareIntentPayloadSchema,
  LegacyDarePayloadSchema.pipe(DareIntentPayloadSchema),
]);

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const DareInput = GuildInput.extend({ dareId: z.number().int().positive() });
const DareEvidenceInput = DareInput.extend({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});
const DarePrepareActionInput = DareInput.extend({
  expectedRevision: z.number().int().positive(),
  payload: DarePayloadInputSchema,
  idempotencyKey: z.uuid(),
});
const DareConfirmActionInput = GuildInput.extend({ intentId: z.uuid() });
const DareDeleteDraftInput = DareInput.extend({
  expectedRevision: z.number().int().positive(),
});

export const bucksDareActionProcedures = {
  dareEvidence: webProcedure
    .input(DareEvidenceInput)
    .query(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const page = await listDareEvidenceV2(
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
      await assertBucksScope(ctx.user, input.guildId);
      const outcome = await createDareV2ConfirmationIntent({
        dareId: input.dareId,
        serverId: input.guildId,
        actorDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        expectedRevision: input.expectedRevision,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
      });
      if (outcome.kind !== "intent_created") return outcome;
      const dare = await prisma.bucksDareV2.findUniqueOrThrow({
        where: { id: input.dareId },
        select: {
          openingStake: true,
          potTotal: true,
          targets: { orderBy: { id: "asc" }, select: { alias: true } },
        },
      });
      const amount =
        input.payload.kind === "dare_contribute"
          ? `${input.payload.amount.toString()} BB to a ${dare.potTotal.toString()} BB pot`
          : input.payload.kind === "dare_fund"
            ? `${dare.openingStake.toString()} BB`
            : null;
      const action = dareV2IntentAction(input.payload.kind);
      return {
        ...outcome,
        confirmation: {
          action,
          amount,
          targets: dare.targets.map((target) => target.alias),
          irreversible: ["fund", "accept", "contribute"].includes(action),
        },
      };
    }),

  dareConfirmAction: webMutationProcedure
    .input(DareConfirmActionInput)
    .mutation(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const intent = await prisma.confirmationIntent.findUnique({
        where: { id: input.intentId },
        select: { dareId: true },
      });
      const outcome = await consumeDareV2ConfirmationIntent({
        intentId: input.intentId,
        serverId: input.guildId,
        actorDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
      });
      const failed = [
        "not_found",
        "forbidden",
        "intent_expired",
        "feature_disabled",
        "insufficient",
      ].includes(outcome.kind);
      const dareId = intent?.dareId ?? null;
      const callout =
        dareId === null || failed ? null : await tryEnsureDareV2Callout(dareId);
      return { ...outcome, callout };
    }),

  dareDeleteDraft: webMutationProcedure
    .input(DareDeleteDraftInput)
    .mutation(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      return await deleteDareDraftV2({
        dareId: input.dareId,
        serverId: input.guildId,
        challengerDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        expectedRevision: input.expectedRevision,
      });
    }),
};
