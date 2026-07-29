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
