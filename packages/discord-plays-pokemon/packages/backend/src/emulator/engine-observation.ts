export const ENGINE_OBSERVATION_VERSION = 1;
export const ENGINE_OBSERVATION_SIZE = 32;

export type CardinalDirection = "north" | "south" | "west" | "east";
export type EngineFacing = CardinalDirection | "unknown";
export type EnginePhase =
  | "unavailable"
  | "overworld"
  | "scripted"
  | "battle"
  | "other";

export type CollisionObservation = Readonly<{
  code: number;
  passable: boolean;
}>;

export type EngineObservationV1 = Readonly<{
  version: 1;
  size: 32;
  frame: number;
  phase: EnginePhase;
  readiness: Readonly<{
    observationValid: boolean;
    inputReady: boolean;
    playerStable: boolean;
    controlsLocked: boolean;
    scriptActive: boolean;
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

export function decodeEngineObservation(
  bytes: Uint8Array,
): EngineObservationV1 {
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
      paletteFading: view.getUint8(27) !== 0,
    },
    world,
  };
}
