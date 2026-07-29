import { z } from "zod";

const WorldSchema = z.looseObject({
  map: z.string(),
  mapGroup: z.number().int(),
  mapNum: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
  facing: z.string(),
});

const BattleSchema = z.looseObject({
  typeFlags: z.number().int(),
  controllerExecFlags: z.number().int(),
  battlersCount: z.number().int(),
  inputBattler: z.number().int().nullable(),
  activeBattler: z.number().int(),
  menu: z.string(),
  actionCursor: z.number().int(),
  moveCursor: z.number().int(),
  currentMove: z.number().int(),
  chosenMove: z.number().int(),
});

const ScreenshotSchema = z.strictObject({
  path: z.string(),
  frame: z.number().int(),
});

const ObservationSchema = z.looseObject({
  schemaVersion: z.literal(2),
  id: z.string(),
  frame: z.number().int(),
  phase: z.string(),
  context: z.looseObject({
    kind: z.string(),
    dialogVisible: z.boolean(),
    dialogInputReady: z.boolean(),
  }),
  readiness: z.looseObject({ inputReady: z.boolean() }),
  world: WorldSchema.nullable(),
  battle: BattleSchema.nullable(),
  screenshot: ScreenshotSchema.optional(),
});

const SemanticOutcomeSchema = z.looseObject({
  schemaVersion: z.literal(1),
  action: z.string(),
  status: z.string(),
  stopReason: z.string(),
  inputApplied: z.boolean().optional(),
  framesElapsed: z.number().int().nonnegative().optional(),
  tilesMoved: z.number().int().nonnegative().optional(),
  attemptsMade: z.number().int().nonnegative().optional(),
  stepsTaken: z.number().int().nonnegative().optional(),
  mapChanged: z.boolean().optional(),
  facingChanged: z.boolean().optional(),
  phaseChanged: z.boolean().optional(),
  battleChanged: z.boolean().optional(),
  stateChanged: z.boolean().optional(),
  visualChanged: z.boolean().optional(),
  visualChangeRatio: z.number().min(0).max(1).optional(),
  map: z
    .looseObject({
      group: z.number().int(),
      number: z.number().int(),
    })
    .nullable()
    .optional(),
  target: z
    .looseObject({
      x: z.number().int(),
      y: z.number().int(),
    })
    .optional(),
  before: ObservationSchema,
  after: ObservationSchema,
});

type ParsedObservation = z.infer<typeof ObservationSchema>;

export function compactPokemonctlObservation(observation: ParsedObservation) {
  const world = observation.world;
  return {
    schemaVersion: observation.schemaVersion,
    id: observation.id,
    frame: observation.frame,
    phase: observation.phase,
    context: observation.context.kind,
    inputReady: observation.readiness.inputReady,
    dialogVisible: observation.context.dialogVisible,
    dialogInputReady: observation.context.dialogInputReady,
    map: world?.map ?? null,
    mapGroup: world?.mapGroup ?? null,
    mapNum: world?.mapNum ?? null,
    x: world?.x ?? null,
    y: world?.y ?? null,
    facing: world?.facing ?? null,
    battle:
      observation.battle === null
        ? null
        : {
            typeFlags: observation.battle.typeFlags,
            controllerExecFlags: observation.battle.controllerExecFlags,
            battlersCount: observation.battle.battlersCount,
            inputBattler: observation.battle.inputBattler,
            activeBattler: observation.battle.activeBattler,
            menu: observation.battle.menu,
            actionCursor: observation.battle.actionCursor,
            moveCursor: observation.battle.moveCursor,
            currentMove: observation.battle.currentMove,
            chosenMove: observation.battle.chosenMove,
          },
    ...(observation.screenshot === undefined
      ? {}
      : { screenshot: observation.screenshot }),
  };
}

export function formatPokemonctlObservationOutput(
  responseText: string,
  full: boolean,
): string {
  if (full) return responseText;
  const observation = ObservationSchema.parse(JSON.parse(responseText));
  return JSON.stringify(compactPokemonctlObservation(observation));
}

export function formatPokemonctlActionOutput(
  responseText: string,
  full: boolean,
): string {
  if (full) return responseText;
  const outcome = SemanticOutcomeSchema.parse(JSON.parse(responseText));
  return JSON.stringify({
    schemaVersion: outcome.schemaVersion,
    action: outcome.action,
    status: outcome.status,
    stopReason: outcome.stopReason,
    ...(outcome.inputApplied === undefined
      ? {}
      : { inputApplied: outcome.inputApplied }),
    ...(outcome.framesElapsed === undefined
      ? {}
      : { framesElapsed: outcome.framesElapsed }),
    ...(outcome.tilesMoved === undefined
      ? {}
      : { tilesMoved: outcome.tilesMoved }),
    ...(outcome.attemptsMade === undefined
      ? {}
      : { attemptsMade: outcome.attemptsMade }),
    ...(outcome.stepsTaken === undefined
      ? {}
      : { stepsTaken: outcome.stepsTaken }),
    ...(outcome.mapChanged === undefined
      ? {}
      : { mapChanged: outcome.mapChanged }),
    ...(outcome.facingChanged === undefined
      ? {}
      : { facingChanged: outcome.facingChanged }),
    ...(outcome.phaseChanged === undefined
      ? {}
      : { phaseChanged: outcome.phaseChanged }),
    ...(outcome.battleChanged === undefined
      ? {}
      : { battleChanged: outcome.battleChanged }),
    ...(outcome.stateChanged === undefined
      ? {}
      : { stateChanged: outcome.stateChanged }),
    ...(outcome.visualChanged === undefined
      ? {}
      : { visualChanged: outcome.visualChanged }),
    ...(outcome.visualChangeRatio === undefined
      ? {}
      : {
          visualChangeRatio:
            Math.round(outcome.visualChangeRatio * 10_000) / 10_000,
        }),
    ...(outcome.map === undefined ? {} : { map: outcome.map }),
    ...(outcome.target === undefined ? {} : { target: outcome.target }),
    before: compactPokemonctlObservation(outcome.before),
    after: compactPokemonctlObservation(outcome.after),
  });
}
