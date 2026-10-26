import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  assertDaresScope,
  resolveDaresScope,
} from "#src/consumer/dares-access.ts";
import {
  inspectVisibleDare,
  listVisibleDarePage,
} from "#src/dares/presentation/dare-view.ts";
import { prisma } from "#src/database/index.ts";
import {
  DareDraftEditorInputSchema,
  DareDraftPreviewInputSchema,
  previewDareDraftEditor,
  reviseDareDraftEditor,
  validateDareDraftEditor,
} from "#src/explore/tools/dare-editor.ts";
import { dareActionProcedures } from "#src/trpc/router/dares/dare-action-procedures.ts";
import { dareNotificationProcedures } from "#src/trpc/router/dares/dare-notification-procedures.ts";
import { router, webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import {
  DareStateSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const DareListInput = GuildInput.extend({
  scope: z.enum(["mine", "guild", "needs_action"]),
  search: z.string().min(1).max(100).optional(),
  states: z.array(DareStateSchema).max(10).optional(),
  role: z.enum(["challenger", "target", "involved"]).optional(),
  sort: z.enum(["needs_action", "deadline", "updated"]).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const DareInspectInput = GuildInput.extend({
  dareId: z.number().int().positive(),
});
const DareDraftInput = DareDraftEditorInputSchema.extend({
  guildId: DiscordGuildIdSchema,
});
const DareDraftPreviewInput = DareDraftPreviewInputSchema.extend({
  guildId: DiscordGuildIdSchema,
});

async function dareManagementAvailable(
  guildId: DiscordGuildId,
  viewerDiscordId: DiscordAccountId,
): Promise<boolean> {
  const [daresEnabled, existingDare] = await Promise.all([
    isPolicyEnabled("dares_enabled", { server: guildId }),
    prisma.dare.findFirst({
      where: {
        serverId: guildId,
        dareState: { not: "deleted" },
        OR: [
          { dareState: { not: "draft" } },
          { challengerDiscordId: viewerDiscordId },
        ],
      },
      select: { id: true },
    }),
  ]);
  return daresEnabled || existingDare !== null;
}

export const daresRouter = router({
  status: webProcedure.query(async ({ ctx }) => {
    const scope = await resolveDaresScope(ctx.user);
    if (scope.kind === "forbidden") {
      return { state: scope.reason } as const;
    }
    const viewerDiscordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
    return {
      state: "available",
      guilds: await Promise.all(
        scope.guilds.map(async (guild) => ({
          id: guild.id,
          name: guild.name,
          daresAvailable: await dareManagementAvailable(
            DiscordGuildIdSchema.parse(guild.id),
            viewerDiscordId,
          ),
        })),
      ),
    } as const;
  }),

  dareList: webProcedure.input(DareListInput).query(async ({ ctx, input }) => {
    await assertDaresScope(ctx.user, input.guildId);
    return await listVisibleDarePage(
      {
        serverId: input.guildId,
        viewerDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        scope: input.scope,
        ...(input.search === undefined ? {} : { search: input.search }),
        ...(input.states === undefined ? {} : { states: input.states }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.sort === undefined ? {} : { sort: input.sort }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      },
      prisma,
    );
  }),

  dareInspect: webProcedure
    .input(DareInspectInput)
    .query(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const dare = await inspectVisibleDare(
        {
          dareId: input.dareId,
          serverId: input.guildId,
          viewerDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        },
        prisma,
      );
      if (dare === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dare not found." });
      }
      return dare;
    }),

  ...dareActionProcedures,
  ...dareNotificationProcedures,

  dareValidateDraft: webProcedure
    .input(DareDraftInput)
    .query(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const { guildId, ...draft } = input;
      return await validateDareDraftEditor(
        draft,
        DiscordAccountIdSchema.parse(ctx.user.discordId),
        [guildId],
      );
    }),

  darePreviewDraft: webProcedure
    .input(DareDraftPreviewInput)
    .query(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const { guildId, ...draft } = input;
      return await previewDareDraftEditor(
        draft,
        DiscordAccountIdSchema.parse(ctx.user.discordId),
        [guildId],
      );
    }),

  dareReviseDraft: webMutationProcedure
    .input(DareDraftInput)
    .mutation(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const { guildId, ...draft } = input;
      return await reviseDareDraftEditor(
        draft,
        DiscordAccountIdSchema.parse(ctx.user.discordId),
        [guildId],
      );
    }),
});
