import { describe, expect, test } from "bun:test";
import { createMemoryReader } from "#src/emulator/memory.ts";
import type { GameSymbols } from "#src/emulator/symbols.ts";
import { readGameSaveDetails } from "./game-save-details.ts";
import {
  SAVE_BLOCK_1_FLAGS_OFFSET,
  SAVE_BLOCK_2_ENCRYPTION_KEY_OFFSET,
  SAVE_BLOCK_2_PLAYER_NAME_LENGTH,
  SAVE_BLOCK_2_PLAYER_NAME_OFFSET,
} from "./save-block-layout.ts";

const SYMBOLS: GameSymbols = {
  gSaveBlock1Ptr: 0x10_00,
  gSaveBlock2Ptr: 0x10_04,
  gPlayerParty: 0x10_10,
  gPlayerPartyCount: 0x10_20,
  gBattleResults: 0x10_30,
  gPlayerAvatar: 0x11_00,
  gObjectEvents: 0x12_00,
};
const SAVE_BLOCK_1 = 0x20_00;
const SAVE_BLOCK_2 = 0x80_00;

function setFlag(view: DataView, id: number): void {
  const address = SAVE_BLOCK_1 + SAVE_BLOCK_1_FLAGS_OFFSET + Math.floor(id / 8);
  view.setUint8(address, view.getUint8(address) | (1 << (id & 7)));
}

function setInitializedPlayerName(view: DataView): void {
  const playerName = [0xbc, 0xbf, 0xcc, 0xbe, 0xbb, 0xc8, 0xff];
  for (const [index, character] of playerName.entries()) {
    view.setUint8(
      SAVE_BLOCK_2 + SAVE_BLOCK_2_PLAYER_NAME_OFFSET + index,
      character,
    );
  }
}

describe("readGameSaveDetails", () => {
  test("uses the wasm32 encryption-key and flag offsets", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);
    const encryptionKey = 0xab_cd_12_34;
    view.setUint32(SYMBOLS.gSaveBlock1Ptr, SAVE_BLOCK_1, true);
    view.setUint32(SYMBOLS.gSaveBlock2Ptr, SAVE_BLOCK_2, true);
    setInitializedPlayerName(view);
    view.setUint32(
      SAVE_BLOCK_2 + SAVE_BLOCK_2_ENCRYPTION_KEY_OFFSET,
      encryptionKey,
      true,
    );
    // Poison the GBA-commented offset. Reading this instead of wasm32's
    // offsetof(SaveBlock2, encryptionKey) recreates the live money corruption.
    view.setUint32(SAVE_BLOCK_2 + 0xac, 0xde_ad_be_ef, true);
    view.setUint32(SAVE_BLOCK_1 + 0x4_90, 3000 ^ encryptionKey, true);
    view.setUint16(SAVE_BLOCK_1 + 0x4_96, 259, true);
    view.setUint16(SAVE_BLOCK_1 + 0x5_60, 13, true);
    view.setUint16(SAVE_BLOCK_1 + 0x5_62, 5 ^ 0x12_34, true);
    view.setUint16(SAVE_BLOCK_1 + 0x6_50, 4, true);
    view.setUint16(SAVE_BLOCK_1 + 0x6_52, 12 ^ 0x12_34, true);
    setFlag(view, 0x8_60);
    setFlag(view, 0x8_61);
    setFlag(view, 0x8_c0);
    const oldFlagsByte = SAVE_BLOCK_1 + 0x12_70 + Math.floor(0x8_7f / 8);
    view.setUint8(
      oldFlagsByte,
      view.getUint8(oldFlagsByte) | (1 << (0x8_7f & 7)),
    );

    const details = readGameSaveDetails(createMemoryReader(memory), SYMBOLS);

    expect(details).not.toBeNull();
    expect(details?.money).toBe(3000);
    expect(details?.registeredItemId).toBe(259);
    expect(details?.inventory).toEqual([
      { itemId: 13, quantity: 5, pocket: "items" },
      { itemId: 4, quantity: 12, pocket: "poke-balls" },
    ]);
    expect(details?.progression).toEqual({
      hasPokemon: true,
      hasPokedex: true,
      hasPokenav: false,
      runningShoes: true,
      isChampion: false,
      receivedPokedexFromBirch: false,
    });
  });

  test("withholds encrypted fields while SaveBlock2 is uninitialized", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);
    const encryptionKey = 0xab_cd_12_34;
    view.setUint32(SYMBOLS.gSaveBlock1Ptr, SAVE_BLOCK_1, true);
    view.setUint32(SYMBOLS.gSaveBlock2Ptr, SAVE_BLOCK_2, true);
    view.setUint32(SAVE_BLOCK_1 + 0x4_90, 3000 ^ encryptionKey, true);
    view.setUint16(SAVE_BLOCK_1 + 0x5_60, 13, true);
    view.setUint16(SAVE_BLOCK_1 + 0x5_62, 5 ^ 0x12_34, true);

    const details = readGameSaveDetails(createMemoryReader(memory), SYMBOLS);

    expect(details).toBeNull();
    for (let index = 0; index < SAVE_BLOCK_2_PLAYER_NAME_LENGTH; index += 1) {
      expect(
        view.getUint8(SAVE_BLOCK_2 + SAVE_BLOCK_2_PLAYER_NAME_OFFSET + index),
      ).toBe(0);
    }
  });

  test("accepts initialized new-game state with encryption key zero", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);
    view.setUint32(SYMBOLS.gSaveBlock1Ptr, SAVE_BLOCK_1, true);
    view.setUint32(SYMBOLS.gSaveBlock2Ptr, SAVE_BLOCK_2, true);
    setInitializedPlayerName(view);
    view.setUint32(SAVE_BLOCK_2 + SAVE_BLOCK_2_ENCRYPTION_KEY_OFFSET, 0, true);
    view.setUint32(SAVE_BLOCK_1 + 0x4_90, 3000, true);
    view.setUint16(SAVE_BLOCK_1 + 0x5_60, 13, true);
    view.setUint16(SAVE_BLOCK_1 + 0x5_62, 5, true);

    const details = readGameSaveDetails(createMemoryReader(memory), SYMBOLS);

    expect(details).not.toBeNull();
    expect(details?.money).toBe(3000);
    expect(details?.inventory).toEqual([
      { itemId: 13, quantity: 5, pocket: "items" },
    ]);
  });
});
