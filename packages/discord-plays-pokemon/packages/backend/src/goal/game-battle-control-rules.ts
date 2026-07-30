import { itemBattleUse } from "#src/game/battle/generated/item-names.ts";
import { moveTarget } from "#src/game/battle/generated/move-names.ts";
import type { GameObservationV2 } from "./game-observation.ts";

type BattleMoveSelection = Readonly<{
  slot?: number;
  moveId?: number;
  targetBattler?: number;
}>;

type BattleState = NonNullable<GameObservationV2["battle"]>;
type BattleMove = BattleState["moves"][number];
type InventoryItem = NonNullable<
  GameObservationV2["game"]
>["inventory"][number];

export type BattleItemSelection = Readonly<{
  inventoryItem: InventoryItem;
  pocket: number;
}>;

const BATTLE_TYPE_DOUBLE = 1;
const BATTLE_TYPE_TRAINER = 1 << 3;
const MOVE_TARGET_SELECTED = 0;
const MOVE_TARGET_USER_OR_SELECTED = 1 << 1;

const INVENTORY_POCKET_INDEX = new Map([
  ["items", 0],
  ["poke-balls", 1],
  ["tm-hm", 2],
  ["berries", 3],
  ["key-items", 4],
]);

export function requireBattleMoveSelection(
  battle: BattleState,
  selection: BattleMoveSelection,
): BattleMove {
  const matchingMove =
    selection.slot === undefined
      ? battle.moves.find((move) => move.moveId === selection.moveId)
      : battle.moves.find((move) => move.slot === selection.slot);
  if (matchingMove === undefined || matchingMove.moveId === 0) {
    throw new Error("requested move is not available to the input battler");
  }
  if (matchingMove.currentPp === 0) {
    throw new Error("requested move has no remaining PP");
  }
  if (selection.targetBattler !== undefined) {
    requireSelectableMoveTarget(
      battle,
      matchingMove.moveId,
      selection.targetBattler,
    );
  }
  return matchingMove;
}

export function requireSwitchablePartySlot(
  observation: GameObservationV2,
  partySlot: number,
): void {
  requireUsablePartySlot(observation, partySlot);
  const activePartySlots =
    observation.battle?.battlers
      .filter((battler) => battler.side === "player" && battler.active)
      .map((battler) => battler.partyIndex) ?? [];
  if (activePartySlots.includes(partySlot - 1)) {
    throw new Error("requested party slot is already active");
  }
}

export function requireBattleItemSelection(
  observation: GameObservationV2,
  battle: BattleState,
  itemId: number,
  partySlot?: number,
): BattleItemSelection {
  const inventoryItem = observation.game?.inventory.find(
    (item) => item.itemId === itemId && item.quantity > 0,
  );
  if (inventoryItem === undefined) {
    throw new Error("requested item is not present in the bag");
  }
  const pocket = INVENTORY_POCKET_INDEX.get(inventoryItem.pocket);
  if (pocket === undefined) {
    throw new RangeError(`unknown inventory pocket: ${inventoryItem.pocket}`);
  }
  requireItemInteraction(observation, battle, itemId, partySlot);
  return { inventoryItem, pocket };
}

function requireUsablePartySlot(
  observation: GameObservationV2,
  partySlot: number,
): void {
  if (!Number.isInteger(partySlot) || partySlot < 1 || partySlot > 6) {
    throw new RangeError("party slot must be an integer from 1 through 6");
  }
  const partyMember = observation.game?.party.at(partySlot - 1);
  if (partyMember === undefined || partyMember.isEgg || partyMember.hp === 0) {
    throw new Error("requested party slot is not a usable Pokémon");
  }
}

function requireSelectableMoveTarget(
  battle: BattleState,
  moveId: number,
  targetBattler: number,
): void {
  const inputBattler = battle.inputBattler;
  if (inputBattler === null) {
    throw new Error("battle decision has no input battler");
  }
  if (
    !battle.battlers.some(
      (battler) => battler.battler === targetBattler && battler.active,
    )
  ) {
    throw new Error("requested target battler is not active");
  }
  const targetMode = moveTarget(moveId);
  const isDoubleBattle = (battle.typeFlags & BATTLE_TYPE_DOUBLE) !== 0;
  const aliveExceptInput = battle.battlers.filter(
    (battler) =>
      battler.active && battler.hp > 0 && battler.battler !== inputBattler,
  ).length;
  const targetMenuAvailable = isDoubleBattle
    ? (targetMode === MOVE_TARGET_SELECTED ||
        targetMode === MOVE_TARGET_USER_OR_SELECTED) &&
      (targetMode === MOVE_TARGET_USER_OR_SELECTED || aliveExceptInput > 1)
    : targetMode === MOVE_TARGET_USER_OR_SELECTED;
  if (!targetMenuAvailable) {
    throw new Error(
      "requested move does not expose a selectable target in this battle",
    );
  }
  if (targetMode === MOVE_TARGET_SELECTED && targetBattler === inputBattler) {
    throw new Error("requested move cannot target its input battler");
  }
}

function requireItemInteraction(
  observation: GameObservationV2,
  battle: BattleState,
  itemId: number,
  partySlot?: number,
): void {
  const use = itemBattleUse(itemId);
  switch (use) {
    case "unavailable":
      throw new Error("requested item is not usable in battle");
    case "move":
      throw new Error(
        "requested item requires a move choice that this action does not accept",
      );
    case "party":
      if (partySlot === undefined) {
        throw new Error("requested item requires a party slot");
      }
      requireUsablePartySlot(observation, partySlot);
      return;
    case "poke-ball":
      if ((battle.typeFlags & BATTLE_TYPE_TRAINER) !== 0) {
        throw new Error("Poké Balls cannot be used in trainer battles");
      }
      if (partySlot !== undefined) {
        throw new Error("requested item does not accept a party slot");
      }
      return;
    case "escape":
      if ((battle.typeFlags & BATTLE_TYPE_TRAINER) !== 0) {
        throw new Error("escape items cannot be used in trainer battles");
      }
      if (partySlot !== undefined) {
        throw new Error("requested item does not accept a party slot");
      }
      return;
    case "direct":
      if (partySlot !== undefined) {
        throw new Error("requested item does not accept a party slot");
      }
  }
}
