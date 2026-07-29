// Layout of the pinned pokeemerald build under the wasm32 ABI. These values
// deliberately come from compiling sizeof/offsetof expressions with the same
// target and headers as pokeemerald.wasm. They are not all equal to the GBA
// offsets annotated in upstream global.h because wasm32 lays out Time and
// ObjectEvent differently.

export const SAVE_BLOCK_1_SIZE = 0x3c_40;
export const SAVE_BLOCK_1_MONEY_OFFSET = 0x4_90;
export const SAVE_BLOCK_1_REGISTERED_ITEM_OFFSET = 0x4_96;
export const SAVE_BLOCK_1_ITEMS_OFFSET = 0x5_60;
export const SAVE_BLOCK_1_KEY_ITEMS_OFFSET = 0x5_d8;
export const SAVE_BLOCK_1_POKE_BALLS_OFFSET = 0x6_50;
export const SAVE_BLOCK_1_TM_HM_OFFSET = 0x6_90;
export const SAVE_BLOCK_1_BERRIES_OFFSET = 0x7_90;
export const SAVE_BLOCK_1_FLAGS_OFFSET = 0x12_48;

export const SAVE_BLOCK_2_SIZE = 0xf_08;
// include/global.h: SaveBlock2.playerName[PLAYER_NAME_LENGTH + 1], where
// PLAYER_NAME_LENGTH is 7. Pokémon strings terminate with EOS (0xff).
export const SAVE_BLOCK_2_PLAYER_NAME_OFFSET = 0;
export const SAVE_BLOCK_2_PLAYER_NAME_LENGTH = 8;
export const SAVE_BLOCK_2_POKEDEX_OFFSET = 0x18;
export const SAVE_BLOCK_2_ENCRYPTION_KEY_OFFSET = 0xa8;
