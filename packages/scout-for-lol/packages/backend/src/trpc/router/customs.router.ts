import {
  CustomAddParticipantInputSchema,
  CustomCreateNightInputSchema,
  CustomGuildInputSchema,
  CustomJoinNightInputSchema,
  CustomRevisionInputSchema,
  CustomSelectAccountInputSchema,
  CustomSelectCaptainsInputSchema,
  CustomPrepareGameInputSchema,
  CustomPickPlayerInputSchema,
  CustomSubstituteInputSchema,
  CustomAssignTeamInputSchema,
  CustomVoiceOverrideInputSchema,
  CustomVoidGameInputSchema,
  CustomIntermissionInputSchema,
  CustomSetAvailabilityInputSchema,
  CustomSetAwayInputSchema,
  CustomSetCohostInputSchema,
  CustomSetHeldInputSchema,
  CustomTargetParticipantInputSchema,
} from "@scout-for-lol/data";
import { activityProcedure, router } from "#src/trpc/trpc.ts";
import {
  activeCustomNight,
  addCustomParticipant,
  joinCustomNight,
  leaveCustomNight,
  removeCustomParticipant,
  setCustomAvailability,
  setCustomAway,
  setCustomCohost,
  setCustomHeld,
  startCustomNight,
} from "#src/customs/service.ts";
import {
  endCustomNight,
  prepareCustomNight,
  selectCustomAccount,
} from "#src/customs/night-lifecycle-service.ts";
import {
  assignCustomTeam,
  chooseCustomCaptains,
  draftCustomPlayer,
  prepareCustomGame,
  randomizeTeams,
  undoDraftPick,
} from "#src/customs/game-service.ts";
import {
  lockCustomTeams,
  retryCustomCode,
  setCustomVoiceOverride,
  substituteCustomParticipant,
  voidCustomGame,
} from "#src/customs/game-operation-service.ts";
import { continueCustomNight } from "#src/customs/intermission-service.ts";
import {
  arrangeCustomVoice,
  returnCustomVoiceToLobby,
} from "#src/customs/voice-service.ts";

export const customsRouter = router({
  active: activityProcedure
    .input(CustomGuildInputSchema)
    .query(({ ctx, input }) => {
      if (input.guildId !== ctx.activitySession.guildId) {
        throw new Error("Activity guild does not match the query");
      }
      return activeCustomNight(ctx.activitySession);
    }),
  startNight: activityProcedure
    .input(CustomCreateNightInputSchema)
    .mutation(({ ctx, input }) => startCustomNight(ctx.activitySession, input)),
  joinNight: activityProcedure
    .input(CustomJoinNightInputSchema)
    .mutation(({ ctx, input }) => joinCustomNight(ctx.activitySession, input)),
  leaveNight: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => leaveCustomNight(ctx.activitySession, input)),
  setAvailability: activityProcedure
    .input(CustomSetAvailabilityInputSchema)
    .mutation(({ ctx, input }) =>
      setCustomAvailability(ctx.activitySession, input),
    ),
  setAway: activityProcedure
    .input(CustomSetAwayInputSchema)
    .mutation(({ ctx, input }) => setCustomAway(ctx.activitySession, input)),
  setHeld: activityProcedure
    .input(CustomSetHeldInputSchema)
    .mutation(({ ctx, input }) => setCustomHeld(ctx.activitySession, input)),
  selectAccount: activityProcedure
    .input(CustomSelectAccountInputSchema)
    .mutation(({ ctx, input }) =>
      selectCustomAccount(ctx.activitySession, input),
    ),
  setCohost: activityProcedure
    .input(CustomSetCohostInputSchema)
    .mutation(({ ctx, input }) => setCustomCohost(ctx.activitySession, input)),
  addParticipant: activityProcedure
    .input(CustomAddParticipantInputSchema)
    .mutation(({ ctx, input }) =>
      addCustomParticipant(ctx.activitySession, input),
    ),
  removeParticipant: activityProcedure
    .input(CustomTargetParticipantInputSchema)
    .mutation(({ ctx, input }) =>
      removeCustomParticipant(ctx.activitySession, input),
    ),
  prepareNight: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      prepareCustomNight(ctx.activitySession, input),
    ),
  prepareGame: activityProcedure
    .input(CustomPrepareGameInputSchema)
    .mutation(({ ctx, input }) =>
      prepareCustomGame(ctx.activitySession, input),
    ),
  selectCaptains: activityProcedure
    .input(CustomSelectCaptainsInputSchema)
    .mutation(({ ctx, input }) =>
      chooseCustomCaptains(ctx.activitySession, input),
    ),
  randomizeTeams: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => randomizeTeams(ctx.activitySession, input)),
  assignTeam: activityProcedure
    .input(CustomAssignTeamInputSchema)
    .mutation(({ ctx, input }) => assignCustomTeam(ctx.activitySession, input)),
  pick: activityProcedure
    .input(CustomPickPlayerInputSchema)
    .mutation(({ ctx, input }) =>
      draftCustomPlayer(ctx.activitySession, input),
    ),
  undoPick: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => undoDraftPick(ctx.activitySession, input)),
  lockTeams: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => lockCustomTeams(ctx.activitySession, input)),
  retryTournamentCode: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => retryCustomCode(ctx.activitySession, input)),
  substitute: activityProcedure
    .input(CustomSubstituteInputSchema)
    .mutation(({ ctx, input }) =>
      substituteCustomParticipant(ctx.activitySession, input),
    ),
  overrideVoice: activityProcedure
    .input(CustomVoiceOverrideInputSchema)
    .mutation(({ ctx, input }) =>
      setCustomVoiceOverride(ctx.activitySession, input),
    ),
  arrangeVoice: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      arrangeCustomVoice(ctx.activitySession, input),
    ),
  returnVoice: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      returnCustomVoiceToLobby(ctx.activitySession, input),
    ),
  continueNight: activityProcedure
    .input(CustomIntermissionInputSchema)
    .mutation(({ ctx, input }) =>
      continueCustomNight(ctx.activitySession, input),
    ),
  voidGame: activityProcedure
    .input(CustomVoidGameInputSchema)
    .mutation(({ ctx, input }) => voidCustomGame(ctx.activitySession, input)),
  endNight: activityProcedure
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => endCustomNight(ctx.activitySession, input)),
});
