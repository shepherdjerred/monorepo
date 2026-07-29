import type { Emulator } from "#src/emulator/emulator.ts";
import type {
  CardinalDirection,
  CollisionObservation,
  EngineFacing,
  EnginePhase,
} from "#src/emulator/engine-observation.ts";
import { BADGES } from "#src/game/events/data/badges.ts";
import { speciesName } from "#src/game/events/generated/species.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { mapName } from "#src/game/spatial/generated/map-names.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";

export type GameObservationV1 = Readonly<{
  schemaVersion: 1;
  id: string;
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
    map: string;
    mapGroup: number;
    mapNum: number;
    x: number;
    y: number;
    facing: EngineFacing;
    movementMode: string;
    runningState: number;
    tileTransitionState: number;
    onTileBehavior: string;
    collision: Readonly<Record<CardinalDirection, CollisionObservation>>;
    nearby: readonly Readonly<{
      dx: number;
      dy: number;
      distance: number;
      facing: EngineFacing;
      kind: "npc" | "item" | "tree" | "rock";
      graphicsId: number;
    }>[];
  }> | null;
  game: Readonly<{
    party: readonly Readonly<{
      speciesId: number;
      species: string;
      nickname: string;
      level: number;
      hp: number;
      maxHp: number;
      isEgg: boolean;
    }>[];
    badges: readonly string[];
    pokedexOwned: number;
    lastCatch: Readonly<{
      speciesId: number;
      species: string;
      shiny: boolean;
    }> | null;
  }> | null;
}>;

function popcount8(byte: number): number {
  let n = byte & 0xff;
  n = n - ((n >> 1) & 0x55);
  n = (n & 0x33) + ((n >> 2) & 0x33);
  return (n + (n >> 4)) & 0x0f;
}

function countDexOwned(bitfield: Uint8Array): number {
  let total = 0;
  for (const byte of bitfield) total += popcount8(byte);
  return total;
}

export function readGameObservation(emulator: Emulator): GameObservationV1 {
  const engine = emulator.engineObservation();
  const reader = emulator.memoryReader();
  const symbols = emulator.gameSymbols();
  const spatial = readSpatialSnapshot(reader, symbols);
  const snapshot = readGameSnapshot(reader, symbols);
  const engineWorld = engine.world;

  const world =
    engineWorld === null
      ? null
      : {
          map: mapName(engineWorld.mapGroup, engineWorld.mapNum),
          mapGroup: engineWorld.mapGroup,
          mapNum: engineWorld.mapNum,
          x: engineWorld.x,
          y: engineWorld.y,
          facing: engineWorld.facing,
          movementMode: engineWorld.movementMode,
          runningState: engineWorld.runningState,
          tileTransitionState: engineWorld.tileTransitionState,
          onTileBehavior:
            spatial?.onTileBehavior ??
            `metatile behavior ${String(engineWorld.currentMetatileBehavior)}`,
          collision: engineWorld.collision,
          nearby:
            spatial?.nearby.map((object) => ({
              dx: object.dx,
              dy: object.dy,
              distance: object.manhattan,
              facing: object.facing,
              kind: object.kind,
              graphicsId: object.graphicsId,
            })) ?? [],
        };

  const earnedBadges: string[] = [];
  if (snapshot !== null) {
    for (let index = 0; index < snapshot.badges.length; index += 1) {
      if (snapshot.badges[index] !== true) continue;
      const badge = BADGES[index];
      if (badge === undefined) {
        throw new RangeError(`unknown badge index: ${String(index)}`);
      }
      earnedBadges.push(badge.name);
    }
  }

  return {
    schemaVersion: 1,
    id: `observation-v1:${String(engine.frame)}`,
    frame: engine.frame,
    phase: engine.phase,
    readiness: engine.readiness,
    world,
    game:
      snapshot === null
        ? null
        : {
            party: snapshot.party.map((mon) => ({
              speciesId: mon.species,
              species: speciesName(mon.species),
              nickname: mon.nickname,
              level: mon.level,
              hp: mon.hp,
              maxHp: mon.maxHp,
              isEgg: mon.isEgg,
            })),
            badges: earnedBadges,
            pokedexOwned: countDexOwned(snapshot.dexOwned),
            lastCatch:
              snapshot.caughtMonSpecies === 0
                ? null
                : {
                    speciesId: snapshot.caughtMonSpecies,
                    species: speciesName(snapshot.caughtMonSpecies),
                    shiny: snapshot.caughtMonShiny,
                  },
          },
  };
}
