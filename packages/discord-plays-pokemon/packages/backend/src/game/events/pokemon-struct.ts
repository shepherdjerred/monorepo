// Pure parser for the Gen-3 party Pokémon struct (100 bytes).
//
// Layout (pokeemerald include/pokemon.h):
//   BoxPokemon @0 (80 bytes):
//     personality u32 @0, otId u32 @4, nickname[10] @8, language u8 @18,
//     flags u8 @19 (isBadEgg:1, hasSpecies:1, isEgg:1), otName[7] @20,
//     markings u8 @27, checksum u16 @28, unknown u16 @30,
//     48-byte XOR-"encrypted" substruct union @32.
//   status u32 @80, level u8 @84, mail u8 @85, hp u16 @86, maxHP u16 @88, ...
//
// The four 12-byte substructs (Growth, Attacks, EVs, Misc) are stored in one
// of 24 orders selected by personality % 24, encrypted by XORing each u32 with
// personality ^ otId. Growth substruct word 0 holds species (u16) + heldItem.

import { decodeGameText } from "./text.ts";

export const PARTY_MON_SIZE = 100;
export const PARTY_MAX = 6;

// pokeemerald counts species ids 0..411 (NUM_SPECIES = SPECIES_EGG = 412).
export const NUM_SPECIES = 412;

const SUBSTRUCT_COUNT = 4;
const SUBSTRUCT_SIZE = 12;
const SUBSTRUCT_BASE = 32;
const NICKNAME_OFFSET = 8;
const NICKNAME_LENGTH = 10;
const FLAGS_OFFSET = 19;
const CHECKSUM_OFFSET = 28;
const STATUS_OFFSET = 80;
const LEVEL_OFFSET = 84;
const HP_OFFSET = 86;
const MAX_HP_OFFSET = 88;

// Substruct order per personality % 24: each entry lists, for substruct types
// [Growth, Attacks, EVs, Misc], the position (0-3) it occupies. Ported from
// the substruct selection in pokeemerald src/pokemon.c (GAEM, GAME, GEAM, ...).
const SUBSTRUCT_POSITIONS: readonly (readonly [
  number,
  number,
  number,
  number,
])[] = [
  [0, 1, 2, 3], // GAEM
  [0, 1, 3, 2], // GAME
  [0, 2, 1, 3], // GEAM
  [0, 3, 1, 2], // GEMA
  [0, 2, 3, 1], // GMAE
  [0, 3, 2, 1], // GMEA
  [1, 0, 2, 3], // AGEM
  [1, 0, 3, 2], // AGME
  [2, 0, 1, 3], // AEGM
  [3, 0, 1, 2], // AEMG
  [2, 0, 3, 1], // AMGE
  [3, 0, 2, 1], // AMEG
  [1, 2, 0, 3], // EGAM
  [1, 3, 0, 2], // EGMA
  [2, 1, 0, 3], // EAGM
  [3, 1, 0, 2], // EAMG
  [2, 3, 0, 1], // EMGA
  [3, 2, 0, 1], // EMAG
  [1, 2, 3, 0], // MGAE
  [1, 3, 2, 0], // MGEA
  [2, 1, 3, 0], // MAGE
  [3, 1, 2, 0], // MAEG
  [2, 3, 1, 0], // MEGA
  [3, 2, 1, 0], // MEAG
];

export type ParsedPartyMon = {
  personality: number;
  otId: number;
  species: number;
  level: number;
  hp: number;
  maxHp: number;
  isEgg: boolean;
  nickname: string;
};

/**
 * Parse a 100-byte party Pokémon. Returns null for empty slots, torn reads
 * (substruct checksum mismatch), or out-of-range species — callers treat null
 * as "no usable mon this poll", which can never produce a false event.
 */
export function parsePartyMon(bytes: Uint8Array): ParsedPartyMon | null {
  if (bytes.length !== PARTY_MON_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const personality = view.getUint32(0, true);
  const otId = view.getUint32(4, true);
  const flags = view.getUint8(FLAGS_OFFSET);
  const isBadEgg = (flags & 0b001) !== 0;
  const hasSpecies = (flags & 0b010) !== 0;
  const isEgg = (flags & 0b100) !== 0;
  if (!hasSpecies || isBadEgg) return null;

  // Decrypt the 48-byte substruct region and verify its checksum.
  const key = (personality ^ otId) >>> 0;
  const decrypted = new DataView(
    new ArrayBuffer(SUBSTRUCT_COUNT * SUBSTRUCT_SIZE),
  );
  for (let i = 0; i < (SUBSTRUCT_COUNT * SUBSTRUCT_SIZE) / 4; i++) {
    const word = view.getUint32(SUBSTRUCT_BASE + i * 4, true);
    decrypted.setUint32(i * 4, (word ^ key) >>> 0, true);
  }
  let sum = 0;
  for (let i = 0; i < (SUBSTRUCT_COUNT * SUBSTRUCT_SIZE) / 2; i++) {
    sum = (sum + decrypted.getUint16(i * 2, true)) & 0xff_ff;
  }
  if (sum !== view.getUint16(CHECKSUM_OFFSET, true)) return null;

  // personality % 24 is always in [0, 23] and the table has 24 rows.
  const positions = SUBSTRUCT_POSITIONS[personality % 24];
  const growthOffset = positions[0] * SUBSTRUCT_SIZE;
  const species = decrypted.getUint16(growthOffset, true);
  if (species === 0 || species >= NUM_SPECIES) return null;

  return {
    personality,
    otId,
    species,
    level: view.getUint8(LEVEL_OFFSET),
    hp: view.getUint16(HP_OFFSET, true),
    maxHp: view.getUint16(MAX_HP_OFFSET, true),
    isEgg,
    nickname: decodeGameText(
      bytes.subarray(NICKNAME_OFFSET, NICKNAME_OFFSET + NICKNAME_LENGTH),
    ),
  };
}

// Exported for tests and the status-condition field if we want it later.
export const PARTY_MON_OFFSETS = {
  status: STATUS_OFFSET,
  level: LEVEL_OFFSET,
  hp: HP_OFFSET,
  maxHp: MAX_HP_OFFSET,
  checksum: CHECKSUM_OFFSET,
  substructBase: SUBSTRUCT_BASE,
} as const;
