export const ENGINE_OBSERVATION_VERSION = 3;
export const ENGINE_OBSERVATION_SIZE = 144;

export type CardinalDirection = "north" | "south" | "west" | "east";
export type EngineFacing = CardinalDirection | "unknown";
export type EnginePhase =
  | "unavailable"
  | "overworld"
  | "scripted"
  | "battle"
  | "other";

export type BattleMenu =
  | "none"
  | "action"
  | "move"
  | "bag"
  | "party"
  | "yes-no"
  | "other"
  | "target";

export type CollisionObservation = Readonly<{
  code: number;
  passable: boolean;
}>;

export type EngineMapTile = Readonly<{
  x: number;
  y: number;
  behavior: number;
  collision: number;
  elevation: number;
  passable: boolean;
}>;

export type EngineObservationV3 = Readonly<{
  version: 3;
  size: 144;
  frame: number;
  phase: EnginePhase;
  readiness: Readonly<{
    observationValid: boolean;
    inputReady: boolean;
    playerStable: boolean;
    controlsLocked: boolean;
    scriptActive: boolean;
    dialogVisible: boolean;
    dialogInputReady: boolean;
    paletteFading: boolean;
  }>;
  world: Readonly<{
    mapGroup: number;
    mapNum: number;
    x: number;
    y: number;
    facing: EngineFacing;
    avatarFlags: number;
    movementMode: string;
    runningState: number;
    tileTransitionState: number;
    currentMetatileBehavior: number;
    collision: Readonly<Record<CardinalDirection, CollisionObservation>>;
  }> | null;
  battle: Readonly<{
    typeFlags: number;
    controllerExecFlags: number;
    battlersCount: number;
    inputBattler: number | null;
    activeBattler: number;
    menu: BattleMenu;
    actionCursor: number;
    moveCursor: number;
    targetBattler: number | null;
    currentMove: number;
    chosenMove: number;
    moves: readonly Readonly<{
      slot: number;
      moveId: number;
      currentPp: number;
      maxPp: number;
    }>[];
    bag: Readonly<{
      state: "list" | "use-confirm";
      pocket: number;
      position: number;
      itemId: number;
    }> | null;
    party: Readonly<{
      inputReady: boolean;
      slot: number;
      layout: number;
      action: number;
    }> | null;
    battlers: readonly Readonly<{
      battler: number;
      side: "player" | "opponent";
      position: number;
      active: boolean;
      speciesId: number;
      hp: number;
      maxHp: number;
      partyIndex: number;
      status: number;
    }>[];
  }> | null;
}>;

const OBSERVATION_VALID = 1;
const INPUT_READY = 2;
const PLAYER_STABLE = 4;

function phaseFromRaw(raw: number): EnginePhase {
  switch (raw) {
    case 0:
      return "unavailable";
    case 1:
      return "overworld";
    case 2:
      return "scripted";
    case 3:
      return "battle";
    case 4:
      return "other";
    default:
      throw new RangeError(`unknown engine observation phase: ${String(raw)}`);
  }
}

function facingFromRaw(raw: number): EngineFacing {
  switch (raw) {
    case 1:
      return "south";
    case 2:
      return "north";
    case 3:
      return "west";
    case 4:
      return "east";
    default:
      return "unknown";
  }
}

function movementModeFromFlags(flags: number): string {
  if ((flags & 0x08) !== 0) return "surfing";
  if ((flags & 0x10) !== 0) return "diving";
  if ((flags & 0x02) !== 0) return "mach bike";
  if ((flags & 0x04) !== 0) return "acro bike";
  if ((flags & 0x80) !== 0) return "running";
  return "on foot";
}

function collision(code: number): CollisionObservation {
  return { code, passable: code === 0 };
}

function battleMenuFromRaw(raw: number): BattleMenu {
  switch (raw) {
    case 0:
      return "none";
    case 1:
      return "action";
    case 2:
      return "move";
    case 3:
      return "bag";
    case 4:
      return "party";
    case 5:
      return "yes-no";
    case 6:
      return "other";
    case 7:
      return "target";
    default:
      throw new RangeError(`unknown battle menu: ${String(raw)}`);
  }
}

function battleSideFromRaw(raw: number): "player" | "opponent" {
  switch (raw) {
    case 0:
      return "player";
    case 1:
      return "opponent";
    default:
      throw new RangeError(`unknown battle side: ${String(raw)}`);
  }
}

function battleBagStateFromRaw(raw: number): "list" | "use-confirm" | null {
  switch (raw) {
    case 0:
      return null;
    case 1:
      return "list";
    case 2:
      return "use-confirm";
    default:
      throw new RangeError(`unknown battle bag state: ${String(raw)}`);
  }
}

export function decodeEngineMapTile(
  x: number,
  y: number,
  packed: number,
): EngineMapTile | null {
  const raw = packed >>> 0;
  if ((raw & 0x80_00_00_00) === 0) return null;
  const collisionCode = (raw >>> 8) & 0xff;
  return {
    x,
    y,
    behavior: raw & 0xff,
    collision: collisionCode,
    elevation: (raw >>> 16) & 0xff,
    passable: collisionCode === 0,
  };
}

export function decodeEngineObservation(
  bytes: Uint8Array,
): EngineObservationV3 {
  if (bytes.byteLength < ENGINE_OBSERVATION_SIZE) {
    throw new RangeError(
      `engine observation is too short: ${String(bytes.byteLength)} bytes`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(0, true);
  const size = view.getUint16(2, true);
  if (
    version !== ENGINE_OBSERVATION_VERSION ||
    size !== ENGINE_OBSERVATION_SIZE
  ) {
    throw new Error(
      `unsupported engine observation ABI: version=${String(version)} size=${String(size)}`,
    );
  }

  const readiness = view.getUint8(9);
  const observationValid = (readiness & OBSERVATION_VALID) !== 0;
  const avatarFlags = view.getUint8(17);
  const world = observationValid
    ? {
        mapGroup: view.getUint8(10),
        mapNum: view.getUint8(11),
        x: view.getInt16(12, true),
        y: view.getInt16(14, true),
        facing: facingFromRaw(view.getUint8(16)),
        avatarFlags,
        movementMode: movementModeFromFlags(avatarFlags),
        runningState: view.getUint8(18),
        tileTransitionState: view.getUint8(19),
        currentMetatileBehavior: view.getUint8(20),
        collision: {
          north: collision(view.getUint8(21)),
          south: collision(view.getUint8(22)),
          west: collision(view.getUint8(23)),
          east: collision(view.getUint8(24)),
        },
      }
    : null;
  const inBattle = view.getUint8(28) !== 0;
  const battlersCount = view.getUint8(31);
  if (inBattle && battlersCount > 4) {
    throw new RangeError(`invalid battler count: ${String(battlersCount)}`);
  }
  const moveCount = view.getUint8(115);
  if (inBattle && moveCount > 4) {
    throw new RangeError(`invalid battle move count: ${String(moveCount)}`);
  }
  const bagState = battleBagStateFromRaw(view.getUint8(132));
  const partyInputReady = view.getUint8(138);
  if (partyInputReady !== 0 && partyInputReady !== 1) {
    throw new RangeError(
      `invalid battle party readiness: ${String(partyInputReady)}`,
    );
  }
  const battle = inBattle
    ? {
        typeFlags: view.getUint32(32, true),
        controllerExecFlags: view.getUint32(36, true),
        battlersCount,
        inputBattler:
          view.getUint8(40) < battlersCount ? view.getUint8(40) : null,
        activeBattler: view.getUint8(42),
        menu: battleMenuFromRaw(view.getUint8(30)),
        actionCursor: view.getUint8(43),
        moveCursor: view.getUint8(44),
        targetBattler:
          view.getUint8(114) < battlersCount ? view.getUint8(114) : null,
        currentMove: view.getUint16(110, true),
        chosenMove: view.getUint16(112, true),
        moves: Array.from({ length: moveCount }, (_, slot) => {
          const offset = 116 + slot * 4;
          return {
            slot: slot + 1,
            moveId: view.getUint16(offset, true),
            currentPp: view.getUint8(offset + 2),
            maxPp: view.getUint8(offset + 3),
          };
        }),
        bag:
          bagState === null
            ? null
            : {
                state: bagState,
                pocket: view.getUint8(133),
                position: view.getUint16(134, true),
                itemId: view.getUint16(136, true),
              },
        party:
          view.getUint8(30) === 4
            ? {
                inputReady: partyInputReady === 1,
                slot: view.getUint8(139),
                layout: view.getUint8(140),
                action: view.getUint8(141),
              }
            : null,
        battlers: Array.from({ length: battlersCount }, (_, battler) => {
          const offset = 46 + battler * 16;
          return {
            battler: view.getUint8(offset),
            side: battleSideFromRaw(view.getUint8(offset + 1)),
            position: view.getUint8(offset + 2),
            active: view.getUint8(offset + 3) !== 0,
            speciesId: view.getUint16(offset + 4, true),
            hp: view.getUint16(offset + 6, true),
            maxHp: view.getUint16(offset + 8, true),
            partyIndex: view.getUint16(offset + 10, true),
            status: view.getUint32(offset + 12, true),
          };
        }),
      }
    : null;

  return {
    version: ENGINE_OBSERVATION_VERSION,
    size: ENGINE_OBSERVATION_SIZE,
    frame: view.getUint32(4, true),
    phase: phaseFromRaw(view.getUint8(8)),
    readiness: {
      observationValid,
      inputReady: (readiness & INPUT_READY) !== 0,
      playerStable: (readiness & PLAYER_STABLE) !== 0,
      controlsLocked: view.getUint8(25) !== 0,
      scriptActive: view.getUint8(26) !== 0,
      dialogVisible: (view.getUint8(45) & 1) !== 0,
      dialogInputReady: (view.getUint8(45) & 2) !== 0,
      paletteFading: view.getUint8(27) !== 0,
    },
    world,
    battle,
  };
}
