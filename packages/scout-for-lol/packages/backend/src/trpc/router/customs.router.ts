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
  CustomResolveVoiceOperationInputSchema,
} from "@scout-for-lol/data";
import { activityProcedure, router } from "#src/trpc/trpc.ts";
import { withOrchestrationProducer } from "#src/temporal/orchestration-cutover.ts";
import { resolveCustomVoiceOperation } from "#src/customs/operations/resolution.ts";
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
} from "#src/customs/game/night-lifecycle-service.ts";
import {
  assignCustomTeam,
  chooseCustomCaptains,
  draftCustomPlayer,
  prepareCustomGame,
  randomizeTeams,
  undoDraftPick,
} from "#src/customs/game/game-service.ts";
import {
  lockCustomTeams,
  retryCustomCode,
  setCustomVoiceOverride,
  substituteCustomParticipant,
  voidCustomGame,
} from "#src/customs/game/game-operation-service.ts";
import { continueCustomNight } from "#src/customs/game/intermission-service.ts";
import {
  arrangeCustomVoice,
  returnCustomVoiceToLobby,
} from "#src/customs/voice-service.ts";

const customMutation = activityProcedure.use(
  async ({ next }) => await withOrchestrationProducer(next),
);

export const customsRouter = router({
  resolveVoiceOperation: activityProcedure
    .input(CustomResolveVoiceOperationInputSchema)
    .mutation(({ ctx, input }) =>
      resolveCustomVoiceOperation(ctx.activitySession, input),
    ),
  active: activityProcedure
    .input(CustomGuildInputSchema)
    .query(({ ctx, input }) => {
      if (input.guildId !== ctx.activitySession.guildId) {
        throw new Error("Activity guild does not match the query");
      }
      return activeCustomNight(ctx.activitySession);
    }),
  startNight: customMutation
    .input(CustomCreateNightInputSchema)
    .mutation(({ ctx, input }) => startCustomNight(ctx.activitySession, input)),
  joinNight: customMutation
    .input(CustomJoinNightInputSchema)
    .mutation(({ ctx, input }) => joinCustomNight(ctx.activitySession, input)),
  leaveNight: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => leaveCustomNight(ctx.activitySession, input)),
  setAvailability: customMutation
    .input(CustomSetAvailabilityInputSchema)
    .mutation(({ ctx, input }) =>
      setCustomAvailability(ctx.activitySession, input),
    ),
  setAway: customMutation
    .input(CustomSetAwayInputSchema)
    .mutation(({ ctx, input }) => setCustomAway(ctx.activitySession, input)),
  setHeld: customMutation
    .input(CustomSetHeldInputSchema)
    .mutation(({ ctx, input }) => setCustomHeld(ctx.activitySession, input)),
  selectAccount: customMutation
    .input(CustomSelectAccountInputSchema)
    .mutation(({ ctx, input }) =>
      selectCustomAccount(ctx.activitySession, input),
    ),
  setCohost: customMutation
    .input(CustomSetCohostInputSchema)
    .mutation(({ ctx, input }) => setCustomCohost(ctx.activitySession, input)),
  addParticipant: customMutation
    .input(CustomAddParticipantInputSchema)
    .mutation(({ ctx, input }) =>
      addCustomParticipant(ctx.activitySession, input),
    ),
  removeParticipant: customMutation
    .input(CustomTargetParticipantInputSchema)
    .mutation(({ ctx, input }) =>
      removeCustomParticipant(ctx.activitySession, input),
    ),
  prepareNight: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      prepareCustomNight(ctx.activitySession, input),
    ),
  prepareGame: customMutation
    .input(CustomPrepareGameInputSchema)
    .mutation(({ ctx, input }) =>
      prepareCustomGame(ctx.activitySession, input),
    ),
  selectCaptains: customMutation
    .input(CustomSelectCaptainsInputSchema)
    .mutation(({ ctx, input }) =>
      chooseCustomCaptains(ctx.activitySession, input),
    ),
  randomizeTeams: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => randomizeTeams(ctx.activitySession, input)),
  assignTeam: customMutation
    .input(CustomAssignTeamInputSchema)
    .mutation(({ ctx, input }) => assignCustomTeam(ctx.activitySession, input)),
  pick: customMutation
    .input(CustomPickPlayerInputSchema)
    .mutation(({ ctx, input }) =>
      draftCustomPlayer(ctx.activitySession, input),
    ),
  undoPick: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => undoDraftPick(ctx.activitySession, input)),
  lockTeams: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => lockCustomTeams(ctx.activitySession, input)),
  // The procedure name is the Activity client's wire contract and predates
  // observed lobbies; it re-opens an observed custom lobby, not a Riot code.
  retryTournamentCode: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => retryCustomCode(ctx.activitySession, input)),
  substitute: customMutation
    .input(CustomSubstituteInputSchema)
    .mutation(({ ctx, input }) =>
      substituteCustomParticipant(ctx.activitySession, input),
    ),
  overrideVoice: customMutation
    .input(CustomVoiceOverrideInputSchema)
    .mutation(({ ctx, input }) =>
      setCustomVoiceOverride(ctx.activitySession, input),
    ),
  arrangeVoice: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      arrangeCustomVoice(ctx.activitySession, input),
    ),
  returnVoice: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      returnCustomVoiceToLobby(ctx.activitySession, input),
    ),
  continueNight: customMutation
    .input(CustomIntermissionInputSchema)
    .mutation(({ ctx, input }) =>
      continueCustomNight(ctx.activitySession, input),
    ),
  voidGame: customMutation
    .input(CustomVoidGameInputSchema)
    .mutation(({ ctx, input }) => voidCustomGame(ctx.activitySession, input)),
  endNight: customMutation
    .input(CustomRevisionInputSchema)
    .mutation(({ ctx, input }) => endCustomNight(ctx.activitySession, input)),
});
