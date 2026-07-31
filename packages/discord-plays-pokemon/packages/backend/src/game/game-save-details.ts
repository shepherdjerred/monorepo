import type { MemoryReader } from "#src/emulator/memory.ts";
import type { GameSymbols } from "#src/emulator/symbols.ts";
import {
  SAVE_BLOCK_1_BERRIES_OFFSET,
  SAVE_BLOCK_1_FLAGS_OFFSET,
  SAVE_BLOCK_1_ITEMS_OFFSET,
  SAVE_BLOCK_1_KEY_ITEMS_OFFSET,
  SAVE_BLOCK_1_MONEY_OFFSET,
  SAVE_BLOCK_1_POKE_BALLS_OFFSET,
  SAVE_BLOCK_1_REGISTERED_ITEM_OFFSET,
  SAVE_BLOCK_1_SIZE,
  SAVE_BLOCK_1_TM_HM_OFFSET,
  SAVE_BLOCK_2_ENCRYPTION_KEY_OFFSET,
  SAVE_BLOCK_2_PLAYER_NAME_LENGTH,
  SAVE_BLOCK_2_PLAYER_NAME_OFFSET,
  SAVE_BLOCK_2_SIZE,
} from "./save-block-layout.ts";

export type InventoryPocket =
  | "items"
  | "key-items"
  | "poke-balls"
  | "tm-hm"
  | "berries";

export type InventoryItem = Readonly<{
  itemId: number;
  quantity: number;
  pocket: InventoryPocket;
}>;

export type ProgressionFlags = Readonly<{
  hasPokemon: boolean;
  hasPokedex: boolean;
  hasPokenav: boolean;
  runningShoes: boolean;
  isChampion: boolean;
  receivedPokedexFromBirch: boolean;
}>;

export type GameSaveDetails = Readonly<{
  money: number;
  registeredItemId: number;
  inventory: readonly InventoryItem[];
  progression: ProgressionFlags;
}>;

const ITEM_SLOT_SIZE = 4;
const POKEMON_TEXT_EOS = 0xff;

const POCKETS: readonly Readonly<{
  pocket: InventoryPocket;
  offset: number;
  capacity: number;
}>[] = [
  { pocket: "items", offset: SAVE_BLOCK_1_ITEMS_OFFSET, capacity: 30 },
  { pocket: "key-items", offset: SAVE_BLOCK_1_KEY_ITEMS_OFFSET, capacity: 30 },
  {
    pocket: "poke-balls",
    offset: SAVE_BLOCK_1_POKE_BALLS_OFFSET,
    capacity: 16,
  },
  { pocket: "tm-hm", offset: SAVE_BLOCK_1_TM_HM_OFFSET, capacity: 64 },
  { pocket: "berries", offset: SAVE_BLOCK_1_BERRIES_OFFSET, capacity: 46 },
];

// include/constants/flags.h at ottohg/pokeemerald-wasm c101be5.
const FLAG_SYS_POKEMON_GET = 0x8_60;
const FLAG_SYS_POKEDEX_GET = 0x8_61;
const FLAG_SYS_POKENAV_GET = 0x8_62;
const FLAG_IS_CHAMPION = 0x8_7f;
const FLAG_SYS_B_DASH = 0x8_c0;
const FLAG_RECEIVED_POKEDEX_FROM_BIRCH = 0x8_e4;

function validPointer(
  address: number,
  size: number,
  memorySize: number,
): boolean {
  return address >= 0x10_00 && address + size <= memorySize;
}

function readFlag(
  reader: MemoryReader,
  saveBlock1: number,
  id: number,
): boolean {
  const byte = reader.u8(
    saveBlock1 + SAVE_BLOCK_1_FLAGS_OFFSET + Math.floor(id / 8),
  );
  return ((byte >> (id & 7)) & 1) === 1;
}

function hasInitializedPlayerName(
  reader: MemoryReader,
  saveBlock2: number,
): boolean {
  for (let index = 0; index < SAVE_BLOCK_2_PLAYER_NAME_LENGTH; index += 1) {
    if (
      reader.u8(saveBlock2 + SAVE_BLOCK_2_PLAYER_NAME_OFFSET + index) ===
      POKEMON_TEXT_EOS
    ) {
      return true;
    }
  }
  return false;
}

export function readGameSaveDetails(
  reader: MemoryReader,
  symbols: GameSymbols,
): GameSaveDetails | null {
  const saveBlock1 = reader.u32(symbols.gSaveBlock1Ptr);
  const saveBlock2 = reader.u32(symbols.gSaveBlock2Ptr);
  if (
    !validPointer(saveBlock1, SAVE_BLOCK_1_SIZE, reader.byteLength) ||
    !validPointer(saveBlock2, SAVE_BLOCK_2_SIZE, reader.byteLength)
  ) {
    return null;
  }
  // The title screen can expose a valid SaveBlock2 pointer before that block
  // is populated. An initialized player name is always EOS-terminated in the
  // pinned ABI, including new games whose encryption key is legitimately zero.
  if (!hasInitializedPlayerName(reader, saveBlock2)) {
    return null;
  }
  const encryptionKey = reader.u32(
    saveBlock2 + SAVE_BLOCK_2_ENCRYPTION_KEY_OFFSET,
  );
  const quantityKey = encryptionKey & 0xff_ff;
  const inventory: InventoryItem[] = [];
  for (const pocket of POCKETS) {
    for (let index = 0; index < pocket.capacity; index += 1) {
      const slot = saveBlock1 + pocket.offset + index * ITEM_SLOT_SIZE;
      const itemId = reader.u16(slot);
      if (itemId === 0) continue;
      inventory.push({
        itemId,
        quantity: reader.u16(slot + 2) ^ quantityKey,
        pocket: pocket.pocket,
      });
    }
  }
  return {
    money:
      (reader.u32(saveBlock1 + SAVE_BLOCK_1_MONEY_OFFSET) ^ encryptionKey) >>>
      0,
    registeredItemId: reader.u16(
      saveBlock1 + SAVE_BLOCK_1_REGISTERED_ITEM_OFFSET,
    ),
    inventory,
    progression: {
      hasPokemon: readFlag(reader, saveBlock1, FLAG_SYS_POKEMON_GET),
      hasPokedex: readFlag(reader, saveBlock1, FLAG_SYS_POKEDEX_GET),
      hasPokenav: readFlag(reader, saveBlock1, FLAG_SYS_POKENAV_GET),
      runningShoes: readFlag(reader, saveBlock1, FLAG_SYS_B_DASH),
      isChampion: readFlag(reader, saveBlock1, FLAG_IS_CHAMPION),
      receivedPokedexFromBirch: readFlag(
        reader,
        saveBlock1,
        FLAG_RECEIVED_POKEDEX_FROM_BIRCH,
      ),
    },
  };
}
