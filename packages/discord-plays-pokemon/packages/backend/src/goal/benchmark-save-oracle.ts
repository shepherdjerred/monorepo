import type {
  CatchStateEvidence,
  PartyIdentityEvidence,
} from "./benchmark-evaluator.ts";
import {
  EMERALD_FLASH_SAVE_BYTES,
  readValidatedEmeraldSaveSlots,
  selectActiveEmeraldSaveSlot,
  type ValidatedEmeraldSaveSlot,
} from "./benchmark-flash-slot.ts";

const SECTOR_DATA_BYTES = 0xf_80;
const SAVE_BLOCK_2_SECTOR_ID = 0;
const SAVE_BLOCK_1_FIRST_SECTOR_ID = 1;
const SAVE_BLOCK_1_SECTOR_COUNT = 4;
const PARTY_COUNT_OFFSET = 0x2_34;
const PARTY_OFFSET = 0x2_38;
const PARTY_CAPACITY = 6;
const PARTY_MON_BYTES = 100;
const BOX_FLAGS_OFFSET = 19;
const BOX_CHECKSUM_OFFSET = 28;
const BOX_SUBSTRUCT_OFFSET = 32;
const BOX_SUBSTRUCT_BYTES = 48;
const GROWTH_SUBSTRUCT_BYTES = 12;
const POKEDEX_OWNED_OFFSET = 0x28;
const POKEDEX_OWNED_BYTES = 52;
const MAX_SPECIES_ID = 411;

const GROWTH_POSITIONS = [
  0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3,
] as const;

function activeSlot(bytes: Uint8Array): ValidatedEmeraldSaveSlot {
  if (bytes.byteLength !== EMERALD_FLASH_SAVE_BYTES) {
    throw new Error(
      `persisted save oracle requires ${String(EMERALD_FLASH_SAVE_BYTES)} bytes; got ${String(bytes.byteLength)}`,
    );
  }
  const slots = readValidatedEmeraldSaveSlots(bytes);
  const active = selectActiveEmeraldSaveSlot(slots.first, slots.second);
  if (active === null) {
    throw new Error("persisted save oracle found no complete active save slot");
  }
  return active;
}

function requiredSector(
  slot: ValidatedEmeraldSaveSlot,
  sectorId: number,
): Uint8Array {
  const sector = slot.sectors.get(sectorId);
  if (sector === undefined) {
    throw new Error(
      `persisted save oracle is missing logical sector ${String(sectorId)}`,
    );
  }
  return sector;
}

function saveBlock1(slot: ValidatedEmeraldSaveSlot): Uint8Array {
  const bytes = new Uint8Array(SAVE_BLOCK_1_SECTOR_COUNT * SECTOR_DATA_BYTES);
  for (let index = 0; index < SAVE_BLOCK_1_SECTOR_COUNT; index += 1) {
    bytes.set(
      requiredSector(slot, SAVE_BLOCK_1_FIRST_SECTOR_ID + index),
      index * SECTOR_DATA_BYTES,
    );
  }
  return bytes;
}

function partyIdentity(bytes: Uint8Array): PartyIdentityEvidence {
  if (bytes.byteLength !== PARTY_MON_BYTES) {
    throw new Error("persisted save oracle received a truncated party member");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const personality = view.getUint32(0, true);
  const otId = view.getUint32(4, true);
  const flags = view.getUint8(BOX_FLAGS_OFFSET);
  if ((flags & 0b010) === 0 || (flags & 0b001) !== 0) {
    throw new Error(
      "persisted save oracle found an empty or invalid listed party member",
    );
  }
  const decrypted = new DataView(new ArrayBuffer(BOX_SUBSTRUCT_BYTES));
  const key = (personality ^ otId) >>> 0;
  for (let offset = 0; offset < BOX_SUBSTRUCT_BYTES; offset += 4) {
    decrypted.setUint32(
      offset,
      (view.getUint32(BOX_SUBSTRUCT_OFFSET + offset, true) ^ key) >>> 0,
      true,
    );
  }
  let checksum = 0;
  for (let offset = 0; offset < BOX_SUBSTRUCT_BYTES; offset += 2) {
    checksum = (checksum + decrypted.getUint16(offset, true)) & 0xff_ff;
  }
  if (checksum !== view.getUint16(BOX_CHECKSUM_OFFSET, true)) {
    throw new Error(
      "persisted save oracle found a party member checksum mismatch",
    );
  }
  const growthPosition = GROWTH_POSITIONS[personality % 24];
  if (growthPosition === undefined) {
    throw new Error(
      "persisted save oracle could not select a growth substruct",
    );
  }
  const species = decrypted.getUint16(
    growthPosition * GROWTH_SUBSTRUCT_BYTES,
    true,
  );
  if (species === 0 || species > MAX_SPECIES_ID) {
    throw new Error(
      `persisted save oracle found invalid species ${String(species)}`,
    );
  }
  return { personality, otId, species };
}

export function decodePersistedCatchState(
  bytes: Uint8Array,
): CatchStateEvidence {
  const slot = activeSlot(bytes);
  const block1 = saveBlock1(slot);
  const partyCount = block1[PARTY_COUNT_OFFSET];
  if (partyCount === undefined || partyCount > PARTY_CAPACITY) {
    throw new Error(
      `persisted save oracle found invalid party count ${String(partyCount)}`,
    );
  }
  const party: PartyIdentityEvidence[] = [];
  for (let index = 0; index < partyCount; index += 1) {
    const offset = PARTY_OFFSET + index * PARTY_MON_BYTES;
    party.push(
      partyIdentity(block1.subarray(offset, offset + PARTY_MON_BYTES)),
    );
  }
  const saveBlock2 = requiredSector(slot, SAVE_BLOCK_2_SECTOR_ID);
  return {
    party,
    dexOwned: saveBlock2.slice(
      POKEDEX_OWNED_OFFSET,
      POKEDEX_OWNED_OFFSET + POKEDEX_OWNED_BYTES,
    ),
  };
}
