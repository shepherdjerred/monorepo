import { TRPCError } from "@trpc/server";
import {
  CustomCreateNightInputSchema,
  CustomIntermissionInputSchema,
  CustomJoinNightInputSchema,
  CustomManualResultInputSchema,
  CustomPickPlayerInputSchema,
  CustomPrepareGameInputSchema,
  CustomRevisionInputSchema,
  CustomSelectAccountInputSchema,
  CustomSetAvailabilityInputSchema,
  CustomSetAwayInputSchema,
  CustomSetHeldInputSchema,
  CustomSetCohostInputSchema,
  CustomSubstituteInputSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { router, activityProcedure } from "#src/trpc/trpc.ts";
import {
  customActorForSession,
  assertCustomVoiceChannelAccess,
  customMemberIdentity,
  customVoiceChannels,
} from "#src/customs/discord-client.ts";
import {
  createCustomNight,
  endCustomNight,
  joinCustomNight,
  setCustomAvailability,
  setCustomAway,
  setCustomHeld,
  setCustomCohost,
} from "#src/customs/service.ts";
import { selectCustomAccount } from "#src/customs/account-service.ts";
import {
  lockCustomTeams,
  makeCustomPick,
  prepareCustomGame,
  recordCustomManualResult,
  selectCustomCaptains,
  undoCustomDraftPick,
} from "#src/customs/game-service.ts";
import {
  getActiveCustomNight,
  getCustomNight,
} from "#src/customs/repository.ts";
import { publishCustomSnapshot } from "#src/customs/socket.ts";
import { createLogger } from "#src/logger.ts";
import { arrangeCustomVoice, cleanupCustomVoice } from "#src/customs/voice.ts";
import { provisionCustomTournamentCode } from "#src/customs/riot-results.ts";
import { returnCustomResultPlayersToLobby } from "#src/customs/result-voice.ts";
import {
  continueCustomNight,
  overrideCustomVoice,
  recordCustomVoiceFailure,
  startCustomGame,
} from "#src/customs/lifecycle-service.ts";
import { assertCustomHostControl } from "#src/customs/authorization.ts";
import {
  rerollCustomCaptains,
  substituteCustomPlayer,
} from "#src/customs/roster-service.ts";
import {
  customsHistoryBootstrapProcedure,
  customsHistoryDetailProcedure,
} from "#src/trpc/router/customs-history.ts";
import {
  assertClaimsGuild,
  broadcast,
  customActorForNight,
} from "#src/trpc/router/customs-shared.ts";

const logger = createLogger("customs-router");

export const customsRouter = router({
  voiceChannels: activityProcedure.query(
    async ({ ctx }) => await customVoiceChannels(ctx.activitySession),
  ),

  active: activityProcedure.query(async ({ ctx }) => {
    return await getActiveCustomNight(prisma, ctx.activitySession.guildId);
  }),

  createNight: activityProcedure
    .input(
      CustomCreateNightInputSchema.omit({
        guildName: true,
        launchChannelId: true,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertClaimsGuild(ctx.activitySession.guildId, input.guildId);
      await assertCustomVoiceChannelAccess(
        ctx.activitySession,
        input.voiceLobbyChannelId,
      );
      const actor = await customActorForSession(ctx.activitySession);
      const identity = await customMemberIdentity(ctx.activitySession);
      return await broadcast(
        await createCustomNight({
          prisma,
          actor,
          guildId: input.guildId,
          guildName: identity.guildName,
          launchChannelId: ctx.activitySession.channelId,
          voiceLobbyChannelId: input.voiceLobbyChannelId,
        }),
      );
    }),

  join: activityProcedure
    .input(
      CustomJoinNightInputSchema.omit({ displayName: true, avatarUrl: true }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await customActorForNight(
        ctx.activitySession,
        input.nightId,
      );
      const identity = await customMemberIdentity(ctx.activitySession);
      return await broadcast(
        await joinCustomNight({ prisma, actor, ...input, ...identity }),
      );
    }),

  setAvailability: activityProcedure
    .input(CustomSetAvailabilityInputSchema)
    .mutation(
      async ({ ctx, input }) =>
        await broadcast(
          await setCustomAvailability({
            prisma,
            actor: await customActorForNight(
              ctx.activitySession,
              input.nightId,
            ),
            ...input,
          }),
        ),
    ),

  setAway: activityProcedure.input(CustomSetAwayInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await setCustomAway({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  setHeld: activityProcedure.input(CustomSetHeldInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await setCustomHeld({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  setCohost: activityProcedure.input(CustomSetCohostInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await setCustomCohost({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  selectAccount: activityProcedure
    .input(CustomSelectAccountInputSchema)
    .mutation(
      async ({ ctx, input }) =>
        await broadcast(
          await selectCustomAccount({
            prisma,
            actor: await customActorForNight(
              ctx.activitySession,
              input.nightId,
            ),
            ...input,
          }),
        ),
    ),

  prepareGame: activityProcedure.input(CustomPrepareGameInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await prepareCustomGame({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  selectCaptains: activityProcedure.input(CustomRevisionInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await selectCustomCaptains({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  rerollCaptains: activityProcedure.input(CustomRevisionInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await rerollCustomCaptains({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  substitute: activityProcedure.input(CustomSubstituteInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await substituteCustomPlayer({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  pick: activityProcedure.input(CustomPickPlayerInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await makeCustomPick({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  undoPick: activityProcedure.input(CustomRevisionInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await undoCustomDraftPick({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  lockTeams: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = await customActorForNight(
        ctx.activitySession,
        input.nightId,
      );
      const locked = await lockCustomTeams({ prisma, actor, ...input });
      if (!locked.applied) return locked;
      publishCustomSnapshot(locked.snapshot);
      let latest = locked;
      try {
        latest = await arrangeCustomVoice({
          prisma,
          nightId: input.nightId,
          actorDiscordId: actor.discordId,
          expectedRevision: latest.snapshot.revision,
        });
        if (!latest.applied) {
          const current = await broadcast(latest);
          return { applied: true, snapshot: current.snapshot };
        }
        publishCustomSnapshot(latest.snapshot);
      } catch (error) {
        logger.error("Custom teams locked but voice arrangement failed", {
          error,
          nightId: input.nightId,
        });
        latest = await recordCustomVoiceFailure({
          prisma,
          nightId: input.nightId,
          actorDiscordId: actor.discordId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (latest.applied) publishCustomSnapshot(latest.snapshot);
      }
      try {
        latest = await provisionCustomTournamentCode({
          prisma,
          nightId: input.nightId,
          actorDiscordId: actor.discordId,
        });
      } catch (error) {
        logger.error(
          "Custom teams locked but Tournament code creation failed",
          { error, nightId: input.nightId },
        );
        const recovered = await getCustomNight(prisma, input.nightId);
        if (recovered !== null) latest = { applied: true, snapshot: recovered };
      }
      return await broadcast(latest);
    }),

  manualResult: activityProcedure
    .input(CustomManualResultInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await recordCustomManualResult({
        prisma,
        actor: await customActorForNight(ctx.activitySession, input.nightId),
        ...input,
      });
      const voiceReturn = result.applied
        ? returnCustomResultPlayersToLobby({
            snapshot: result.snapshot,
            nightId: input.nightId,
            source: "manual",
          })
        : null;
      const response = await broadcast(result);
      if (voiceReturn !== null) void voiceReturn;
      return response;
    }),

  retryVoice: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = await customActorForNight(
        ctx.activitySession,
        input.nightId,
      );
      const snapshot = await getCustomNight(prisma, input.nightId);
      if (snapshot === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom night not found",
        });
      }
      assertCustomHostControl(
        snapshot,
        actor.discordId,
        actor.discordAdministrator,
      );
      return await broadcast(
        await arrangeCustomVoice({
          prisma,
          nightId: input.nightId,
          actorDiscordId: actor.discordId,
          expectedRevision: input.expectedRevision,
        }),
      );
    }),

  overrideVoice: activityProcedure.input(CustomRevisionInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await overrideCustomVoice({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  retryTournamentCode: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = await customActorForNight(
        ctx.activitySession,
        input.nightId,
      );
      const snapshot = await getCustomNight(prisma, input.nightId);
      if (snapshot === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom night not found",
        });
      }
      assertCustomHostControl(
        snapshot,
        actor.discordId,
        actor.discordAdministrator,
      );
      if (snapshot.revision !== input.expectedRevision)
        return { applied: false, snapshot };
      return await broadcast(
        await provisionCustomTournamentCode({
          prisma,
          nightId: input.nightId,
          actorDiscordId: actor.discordId,
          expectedRevision: input.expectedRevision,
        }),
      );
    }),

  startGame: activityProcedure.input(CustomRevisionInputSchema).mutation(
    async ({ ctx, input }) =>
      await broadcast(
        await startCustomGame({
          prisma,
          actor: await customActorForNight(ctx.activitySession, input.nightId),
          ...input,
        }),
      ),
  ),

  continueNight: activityProcedure
    .input(CustomIntermissionInputSchema)
    .mutation(
      async ({ ctx, input }) =>
        await broadcast(
          await continueCustomNight({
            prisma,
            actor: await customActorForNight(
              ctx.activitySession,
              input.nightId,
            ),
            ...input,
          }),
        ),
    ),

  endNight: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const snapshot = await getCustomNight(prisma, input.nightId);
      if (snapshot === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom night not found",
        });
      }
      const actor = await customActorForNight(
        ctx.activitySession,
        input.nightId,
      );
      assertCustomHostControl(
        snapshot,
        actor.discordId,
        actor.discordAdministrator,
      );
      if (snapshot.revision !== input.expectedRevision)
        return { applied: false, snapshot };
      const ended = await endCustomNight({ prisma, actor, ...input });
      if (!ended.applied) return ended;
      const broadcastResult = await broadcast(ended);
      try {
        const failures = await cleanupCustomVoice(broadcastResult.snapshot);
        if (failures.length > 0)
          logger.error("Custom night ended with voice cleanup failures", {
            failures,
            nightId: input.nightId,
          });
      } catch (error) {
        logger.error("Custom night ended but voice cleanup failed", {
          error,
          nightId: input.nightId,
        });
      }
      return broadcastResult;
    }),

  historyBootstrap: customsHistoryBootstrapProcedure,
  historyDetail: customsHistoryDetailProcedure,
});
