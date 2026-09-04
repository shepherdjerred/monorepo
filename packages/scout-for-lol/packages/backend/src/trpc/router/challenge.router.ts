import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AccountIdSchema,
  ChallengeContractV1Schema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import {
  assertChallengeRunsEnabled,
  challengeRunsEnabled,
} from "#src/progression/challenges/access.ts";
import {
  getChallengeTemplate,
  publishChallengeDraft,
  searchChallengeCatalog,
} from "#src/progression/challenges/catalog.ts";
import {
  getChallengeDraft,
  previewChallengeDraft,
  validateChallengeDraft,
} from "#src/progression/challenges/drafts.ts";
import { launchChallengeRunRecompute } from "#src/progression/challenges/launch.ts";
import {
  changeChallengeRunAccounts,
  getChallengeRun,
  getChallengeRunHistory,
  startChallengeRun,
} from "#src/progression/challenges/run-store.ts";
import { router, webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";
import { resolveGuildPermissions } from "#src/trpc/guild-permission.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

const TemplateInputSchema = z.strictObject({ templateId: z.uuid() });
const DraftInputSchema = z.strictObject({
  contract: ChallengeContractV1Schema,
  sourceTemplateId: z.uuid().optional(),
});
const PreviewInputSchema = z.strictObject({
  draftId: z.uuid(),
  accountIds: AccountIdSchema.array().min(1),
  startAt: z.date(),
  endAt: z.date(),
});
const RunModeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clean_slate") }),
  z.strictObject({ kind: z.literal("import"), startAt: z.date() }),
  z.strictObject({ kind: z.literal("earliest_known") }),
]);
const StartRunInputSchema = z.strictObject({
  templateId: z.uuid(),
  accountIds: AccountIdSchema.array().min(1),
  mode: RunModeSchema,
});
type StartRunInput = z.infer<typeof StartRunInputSchema>;

function ownerId(discordId: string) {
  return DiscordAccountIdSchema.parse(discordId);
}

function userInputError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      error instanceof Error ? error.message : "Challenge request failed",
    cause: error,
  });
}

async function startRunForUser(
  discordId: string,
  input: StartRunInput,
): Promise<{ readonly runId: string; readonly revision: number }> {
  const request = await startChallengeRun(prisma, {
    ownerDiscordId: ownerId(discordId),
    templateId: input.templateId,
    accountIds: input.accountIds,
    mode: input.mode,
    stage: configuration.environment,
  });
  await launchChallengeRunRecompute({
    stage: configuration.environment,
    runId: request.runId,
    revision: request.revision,
  });
  return request;
}

async function assertRunVisibility(
  user: NonNullable<Parameters<typeof fetchUserGuildsForRequest>[0]>,
  runId: string,
): Promise<boolean> {
  const run = await prisma.challengeRun.findUniqueOrThrow({
    where: { id: runId },
    select: { ownerDiscordId: true },
  });
  if (run.ownerDiscordId === user.discordId) return true;

  const guilds = await fetchUserGuildsForRequest(user);
  const guildIds = guilds.map((guild) => DiscordGuildIdSchema.parse(guild.id));
  const runOwnerDiscordId = ownerId(run.ownerDiscordId);
  const sharedPlayers = await prisma.player.findMany({
    where: {
      discordId: runOwnerDiscordId,
      serverId: { in: guildIds },
    },
    select: { serverId: true },
  });
  const enabled = await Promise.all(
    sharedPlayers.map((player) =>
      isPolicyEnabled("challenge_runs_enabled", {
        server: DiscordGuildIdSchema.parse(player.serverId),
      }),
    ),
  );
  if (enabled.some(Boolean)) return false;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Challenge runs are visible only to members of the owner's guild",
  });
}

export const challengeRouter = router({
  status: webProcedure.query(async ({ ctx }) => ({
    enabled: await challengeRunsEnabled(ctx.user),
  })),
  catalogSearch: webProcedure
    .input(z.strictObject({ query: z.string().max(120).optional() }))
    .query(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      return await searchChallengeCatalog(prisma, input.query);
    }),
  detail: webProcedure
    .input(TemplateInputSchema)
    .query(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      return await getChallengeTemplate(prisma, input.templateId);
    }),
  linkedAccounts: webProcedure.query(async ({ ctx }) => {
    await assertChallengeRunsEnabled(ctx.user);
    const players = await prisma.player.findMany({
      where: { discordId: ctx.user.discordId },
      orderBy: [{ alias: "asc" }, { serverId: "asc" }],
      include: { accounts: { orderBy: { alias: "asc" } } },
    });
    return players.flatMap((player) =>
      player.accounts.map((account) => ({
        id: AccountIdSchema.parse(account.id),
        puuid: account.puuid,
        accountAlias: account.alias,
        playerAlias: player.alias,
        guildId: player.serverId,
      })),
    );
  }),
  getDraft: webProcedure
    .input(z.strictObject({ draftId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        return await getChallengeDraft(prisma, {
          ownerDiscordId: ownerId(ctx.user.discordId),
          draftId: input.draftId,
        });
      } catch (error) {
        return userInputError(error);
      }
    }),
  validateDraft: webMutationProcedure
    .input(DraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        return await validateChallengeDraft(prisma, {
          ownerDiscordId: ownerId(ctx.user.discordId),
          contract: input.contract,
          ...(input.sourceTemplateId === undefined
            ? {}
            : { sourceTemplateId: input.sourceTemplateId }),
        });
      } catch (error) {
        return userInputError(error);
      }
    }),
  previewDraft: webMutationProcedure
    .input(PreviewInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        return await previewChallengeDraft(prisma, {
          ownerDiscordId: ownerId(ctx.user.discordId),
          draftId: input.draftId,
          accountIds: input.accountIds,
          startAt: input.startAt,
          endAt: input.endAt,
        });
      } catch (error) {
        return userInputError(error);
      }
    }),
  publishDraft: webMutationProcedure
    .input(z.strictObject({ draftId: z.uuid(), confirmed: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        return await publishChallengeDraft(prisma, {
          ownerDiscordId: ownerId(ctx.user.discordId),
          draftId: input.draftId,
        });
      } catch (error) {
        return userInputError(error);
      }
    }),
  startRun: webMutationProcedure
    .input(StartRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        return await startRunForUser(ctx.user.discordId, input);
      } catch (error) {
        return userInputError(error);
      }
    }),
  restartRun: webMutationProcedure
    .input(StartRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        return await startRunForUser(ctx.user.discordId, input);
      } catch (error) {
        return userInputError(error);
      }
    }),
  changeAccounts: webMutationProcedure
    .input(
      z.strictObject({
        runId: z.uuid(),
        accountIds: AccountIdSchema.array().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        const request = await changeChallengeRunAccounts(prisma, {
          ownerDiscordId: ownerId(ctx.user.discordId),
          runId: input.runId,
          accountIds: input.accountIds,
          stage: configuration.environment,
        });
        await launchChallengeRunRecompute({
          stage: configuration.environment,
          runId: request.runId,
          revision: request.revision,
        });
        return request;
      } catch (error) {
        return userInputError(error);
      }
    }),
  getRun: webProcedure
    .input(z.strictObject({ runId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      try {
        const canManage = await assertRunVisibility(ctx.user, input.runId);
        return { ...(await getChallengeRun(prisma, input.runId)), canManage };
      } catch (error) {
        return userInputError(error);
      }
    }),
  runHistory: webProcedure.query(async ({ ctx }) => {
    await assertChallengeRunsEnabled(ctx.user);
    return await getChallengeRunHistory(prisma, ownerId(ctx.user.discordId));
  }),
  profileRuns: webProcedure
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        alias: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertChallengeRunsEnabled(ctx.user);
      await resolveGuildPermissions(ctx.user, input.guildId);
      if (
        !(await isPolicyEnabled("challenge_runs_enabled", {
          server: input.guildId,
        }))
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Challenge runs are unavailable",
        });
      }
      const player = await prisma.player.findFirstOrThrow({
        where: { serverId: input.guildId, alias: input.alias },
      });
      if (player.discordId === null) return [];
      return await getChallengeRunHistory(prisma, ownerId(player.discordId));
    }),
  profileRunsByPlayerId: webProcedure
    .input(z.strictObject({ playerId: PlayerIdSchema }))
    .query(async ({ ctx, input }) => {
      const guilds = await assertConsumerPlayerScope(ctx.user);
      const guildIds = guilds.map((guild) =>
        DiscordGuildIdSchema.parse(guild.id),
      );
      const player = await prisma.player.findFirst({
        where: { id: input.playerId, serverId: { in: guildIds } },
        select: { discordId: true, serverId: true },
      });
      if (player === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Player was not found",
        });
      }
      const serverId = DiscordGuildIdSchema.parse(player.serverId);
      if (
        !(await isPolicyEnabled("challenge_runs_enabled", { server: serverId }))
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Challenge runs are unavailable",
        });
      }
      if (player.discordId === null) return [];
      return await getChallengeRunHistory(prisma, ownerId(player.discordId));
    }),
});
