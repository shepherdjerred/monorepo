import type { Emulator } from "#src/emulator/emulator.ts";
import type {
  BattleMenu,
  CardinalDirection,
  CollisionObservation,
  EngineFacing,
  EnginePhase,
} from "#src/emulator/engine-observation.ts";
import { BADGES } from "#src/game/events/data/badges.ts";
import { speciesName } from "#src/game/events/generated/species.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { itemName } from "#src/game/battle/generated/item-names.ts";
import { moveName } from "#src/game/battle/generated/move-names.ts";
import { mapName } from "#src/game/spatial/generated/map-names.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import {
  readGameSaveDetails,
  type InventoryPocket,
  type ProgressionFlags,
} from "#src/game/game-save-details.ts";

export type GameObservationV2 = Readonly<{
  schemaVersion: 2;
  id: string;
  frame: number;
  phase: EnginePhase;
  context: Readonly<{
    kind:
      | "unavailable"
      | "field"
      | "script-or-dialog"
      | "battle"
      | "menu-or-transition";
    battleActive: boolean;
    scriptOrDialogActive: boolean;
    dialogVisible: boolean;
    dialogInputReady: boolean;
    menuOrTransitionActive: boolean;
  }>;
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
    switchAllowed: boolean;
    moves: readonly Readonly<{
      slot: number;
      moveId: number;
      move: string;
      currentPp: number;
      maxPp: number;
      usable: boolean;
    }>[];
    bag: Readonly<{
      state: "list" | "use-confirm";
      pocket: number;
      position: number;
      itemId: number;
      item: string;
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
      species: string;
      hp: number;
      maxHp: number;
      partyIndex: number;
      status: number;
    }>[];
  }> | null;
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
    money: number;
    registeredItemId: number;
    inventory: readonly Readonly<{
      itemId: number;
      item: string;
      quantity: number;
      pocket: InventoryPocket;
    }>[];
    progression: ProgressionFlags;
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

function contextFromEngine(
  phase: EnginePhase,
  dialogVisible: boolean,
  dialogInputReady: boolean,
): GameObservationV2["context"] {
  return {
    kind:
      phase === "unavailable"
        ? "unavailable"
        : phase === "overworld"
          ? "field"
          : phase === "scripted"
            ? "script-or-dialog"
            : phase === "battle"
              ? "battle"
              : "menu-or-transition",
    battleActive: phase === "battle",
    scriptOrDialogActive: phase === "scripted",
    dialogVisible,
    dialogInputReady,
    menuOrTransitionActive: phase === "other",
  };
}

export function readGameObservation(emulator: Emulator): GameObservationV2 {
  const engine = emulator.engineObservation();
  const reader = emulator.memoryReader();
  const symbols = emulator.gameSymbols();
  const spatial = readSpatialSnapshot(reader, symbols);
  const snapshot = readGameSnapshot(reader, symbols);
  const details = readGameSaveDetails(reader, symbols);
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
    schemaVersion: 2,
    id: `observation-v2:${String(engine.frame)}`,
    frame: engine.frame,
    phase: engine.phase,
    context: contextFromEngine(
      engine.phase,
      engine.readiness.dialogVisible,
      engine.readiness.dialogInputReady,
    ),
    readiness: engine.readiness,
    battle:
      engine.battle === null
        ? null
        : {
            ...engine.battle,
            moves: engine.battle.moves.map((move) => ({
              ...move,
              move: moveName(move.moveId),
            })),
            bag:
              engine.battle.bag === null
                ? null
                : {
                    ...engine.battle.bag,
                    item: itemName(engine.battle.bag.itemId),
                  },
            battlers: engine.battle.battlers.map((battler) => ({
              ...battler,
              species: speciesName(battler.speciesId),
            })),
          },
    world,
    game:
      snapshot === null || details === null
        ? null
        : {
            money: details.money,
            registeredItemId: details.registeredItemId,
            inventory: details.inventory.map((item) => ({
              ...item,
              item: itemName(item.itemId),
            })),
            progression: details.progression,
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
