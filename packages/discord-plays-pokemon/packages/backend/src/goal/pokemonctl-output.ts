import { z } from "zod";

const WorldSchema = z.looseObject({
  map: z.string(),
  mapGroup: z.number().int(),
  mapNum: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
  facing: z.string(),
  movementMode: z.string(),
  onTileBehavior: z.string(),
});

const BattlerSchema = z.looseObject({
  battler: z.number().int(),
  side: z.string(),
  position: z.number().int(),
  active: z.boolean(),
  speciesId: z.number().int(),
  species: z.string(),
  hp: z.number().int(),
  maxHp: z.number().int(),
  partyIndex: z.number().int(),
  status: z.number().int(),
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
  targetBattler: z.number().int().nullable(),
  currentMove: z.number().int(),
  chosenMove: z.number().int(),
  switchAllowed: z.boolean(),
  moves: z.array(
    z.looseObject({
      slot: z.number().int(),
      moveId: z.number().int(),
      move: z.string(),
      currentPp: z.number().int(),
      maxPp: z.number().int(),
      usable: z.boolean(),
    }),
  ),
  bag: z
    .looseObject({
      state: z.string(),
      pocket: z.number().int(),
      position: z.number().int(),
      itemId: z.number().int(),
      item: z.string(),
    })
    .nullable(),
  party: z
    .looseObject({
      inputReady: z.boolean(),
      slot: z.number().int(),
      layout: z.number().int(),
      action: z.number().int(),
    })
    .nullable(),
  battlers: z.array(BattlerSchema),
});

const GameSchema = z.looseObject({
  money: z.number().int(),
  registeredItemId: z.number().int(),
  inventory: z.array(
    z.looseObject({
      itemId: z.number().int(),
      item: z.string(),
      quantity: z.number().int(),
      pocket: z.string(),
    }),
  ),
  progression: z.looseObject({
    hasPokemon: z.boolean(),
    hasPokedex: z.boolean(),
    hasPokenav: z.boolean(),
    runningShoes: z.boolean(),
    isChampion: z.boolean(),
    receivedPokedexFromBirch: z.boolean(),
  }),
  party: z.array(
    z.looseObject({
      speciesId: z.number().int(),
      species: z.string(),
      nickname: z.string(),
      level: z.number().int(),
      hp: z.number().int(),
      maxHp: z.number().int(),
      isEgg: z.boolean(),
    }),
  ),
  badges: z.array(z.string()),
  pokedexOwned: z.number().int().nonnegative(),
  lastCatch: z
    .looseObject({
      speciesId: z.number().int(),
      species: z.string(),
      shiny: z.boolean(),
    })
    .nullable(),
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
  game: GameSchema.nullable(),
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
  exitId: z.string().optional(),
  before: ObservationSchema,
  after: ObservationSchema,
});

type ParsedObservation = z.infer<typeof ObservationSchema>;

function compactBattleDecision(
  battle: NonNullable<ParsedObservation["battle"]>,
): Record<string, unknown> {
  return {
    typeFlags: battle.typeFlags,
    controllerExecFlags: battle.controllerExecFlags,
    battlersCount: battle.battlersCount,
    inputBattler: battle.inputBattler,
    activeBattler: battle.activeBattler,
    menu: battle.menu,
    actionCursor: battle.actionCursor,
    moveCursor: battle.moveCursor,
    targetBattler: battle.targetBattler,
    currentMove: battle.currentMove,
    chosenMove: battle.chosenMove,
    switchAllowed: battle.switchAllowed,
    moves: battle.moves,
    bag: battle.bag,
    party: battle.party,
  };
}

function compactBattleDecisionOrNull(battle: ParsedObservation["battle"]) {
  return battle === null ? null : compactBattleDecision(battle);
}

function compactPokemonctlObservationCore(observation: ParsedObservation) {
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
    battle: compactBattleDecisionOrNull(observation.battle),
    ...(observation.screenshot === undefined
      ? {}
      : { screenshot: observation.screenshot }),
  };
}

export function compactPokemonctlObservation(observation: ParsedObservation) {
  const core = compactPokemonctlObservationCore(observation);
  return {
    ...core,
    movementMode: observation.world?.movementMode ?? null,
    onTileBehavior: observation.world?.onTileBehavior ?? null,
    battle:
      observation.battle === null
        ? null
        : {
            ...compactBattleDecision(observation.battle),
            battlers: observation.battle.battlers,
          },
    game: observation.game,
  };
}

function compactPosition(observation: ParsedObservation) {
  return observation.world === null
    ? null
    : {
        mapGroup: observation.world.mapGroup,
        mapNum: observation.world.mapNum,
        x: observation.world.x,
        y: observation.world.y,
        facing: observation.world.facing,
      };
}

function changedValue<T>(before: T, after: T): { before: T; after: T } | null {
  return JSON.stringify(before) === JSON.stringify(after)
    ? null
    : { before, after };
}

function compactActionDelta(
  before: ParsedObservation,
  after: ParsedObservation,
) {
  return {
    phase: changedValue(before.phase, after.phase),
    context: changedValue(before.context.kind, after.context.kind),
    inputReady: changedValue(
      before.readiness.inputReady,
      after.readiness.inputReady,
    ),
    position: changedValue(compactPosition(before), compactPosition(after)),
    battleDecision: changedValue(
      compactBattleDecisionOrNull(before.battle),
      compactBattleDecisionOrNull(after.battle),
    ),
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
    ...(outcome.exitId === undefined ? {} : { exitId: outcome.exitId }),
    delta: compactActionDelta(outcome.before, outcome.after),
    before: compactPokemonctlObservationCore(outcome.before),
    after: compactPokemonctlObservation(outcome.after),
  });
}
