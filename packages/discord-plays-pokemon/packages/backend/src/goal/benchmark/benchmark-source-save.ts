import {
  EMERALD_FLASH_SAVE_BYTES,
  readValidatedEmeraldSaveSlots,
  selectActiveEmeraldSaveSlot,
  type ValidatedEmeraldSaveSlot,
} from "./benchmark-flash-slot.ts";

const SAVE_BLOCK_1_SECTOR_ID = 1;
const SAVE_BLOCK_1_PARTY_COUNT_OFFSET = 0x2_34;
const PARTY_CAPACITY = 6;

type SaveSlotPartyCount = Readonly<{
  counter: number;
  partyCount: number;
}>;

export type CapturedBenchmarkSourceSave = Readonly<{
  bytes: Uint8Array;
  sha256: string;
}>;

export async function captureCatchBenchmarkSourceSave(
  filePath: string,
): Promise<CapturedBenchmarkSourceSave> {
  const bytes = await Bun.file(filePath).bytes();
  validateCatchBenchmarkSourceSave(bytes);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return {
    bytes,
    sha256: hasher.digest("hex"),
  };
}

function saveSlotPartyCount(
  slot: ValidatedEmeraldSaveSlot,
): SaveSlotPartyCount {
  const saveBlock1Start = slot.sectors.get(SAVE_BLOCK_1_SECTOR_ID);
  if (saveBlock1Start === undefined) {
    throw new Error("validated source save slot is missing SaveBlock1");
  }
  return {
    counter: slot.counter,
    partyCount:
      saveBlock1Start[SAVE_BLOCK_1_PARTY_COUNT_OFFSET] ?? PARTY_CAPACITY + 1,
  };
}

export function validateCatchBenchmarkSourceSave(bytes: Uint8Array): void {
  if (bytes.byteLength !== EMERALD_FLASH_SAVE_BYTES) {
    throw new Error(
      `source save must be exactly ${String(EMERALD_FLASH_SAVE_BYTES)} bytes; got ${String(bytes.byteLength)}`,
    );
  }
  const slots = readValidatedEmeraldSaveSlots(bytes);
  const activeSlot = selectActiveEmeraldSaveSlot(slots.first, slots.second);
  if (activeSlot === null) {
    throw new Error(
      "source save has no valid slot containing SaveBlock1 party data",
    );
  }
  const active = saveSlotPartyCount(activeSlot);
  if (active.partyCount > PARTY_CAPACITY) {
    throw new Error(
      `source save has invalid party count ${String(active.partyCount)}`,
    );
  }
  if (active.partyCount === PARTY_CAPACITY) {
    throw new Error(
      "source save has a full party; catch benchmark requires an empty party slot so every successful catch produces independent party-identity evidence",
    );
  }
}
