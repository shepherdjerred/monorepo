const EMERALD_FLASH_SAVE_BYTES = 128 * 1024;
const SAVE_SLOT_SECTORS = 14;
const SAVE_SECTOR_BYTES = 0x10_00;
const SAVE_SLOT_BYTES = SAVE_SLOT_SECTORS * SAVE_SECTOR_BYTES;
const SAVE_SECTOR_ID_OFFSET = 0xf_f4;
const SAVE_SECTOR_SIGNATURE_OFFSET = 0xf_f8;
const SAVE_SECTOR_COUNTER_OFFSET = 0xf_fc;
const SAVE_SECTOR_SIGNATURE = 0x08_01_20_25;
const SAVE_BLOCK_1_SECTOR_ID = 1;
const SAVE_BLOCK_1_PARTY_COUNT_OFFSET = 0x2_34;
const PARTY_CAPACITY = 6;

type SaveSlotPartyCount = Readonly<{
  counter: number;
  partyCount: number;
}>;

function saveSlotPartyCount(
  bytes: Uint8Array,
  slotOffset: number,
): SaveSlotPartyCount | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorIds = new Set<number>();
  let partyCount: number | undefined;
  let counter: number | undefined;
  for (let sector = 0; sector < SAVE_SLOT_SECTORS; sector += 1) {
    const offset = slotOffset + sector * SAVE_SECTOR_BYTES;
    if (
      view.getUint32(offset + SAVE_SECTOR_SIGNATURE_OFFSET, true) !==
      SAVE_SECTOR_SIGNATURE
    ) {
      return null;
    }
    const sectorId = view.getUint16(offset + SAVE_SECTOR_ID_OFFSET, true);
    const sectorCounter = view.getUint32(
      offset + SAVE_SECTOR_COUNTER_OFFSET,
      true,
    );
    if (
      sectorId >= SAVE_SLOT_SECTORS ||
      sectorIds.has(sectorId) ||
      (counter !== undefined && counter !== sectorCounter)
    ) {
      return null;
    }
    sectorIds.add(sectorId);
    counter = sectorCounter;
    if (sectorId === SAVE_BLOCK_1_SECTOR_ID) {
      partyCount =
        bytes[offset + SAVE_BLOCK_1_PARTY_COUNT_OFFSET] ?? PARTY_CAPACITY + 1;
    }
  }
  if (
    sectorIds.size !== SAVE_SLOT_SECTORS ||
    counter === undefined ||
    partyCount === undefined
  ) {
    return null;
  }
  return { counter, partyCount };
}

export function validateCatchBenchmarkSourceSave(bytes: Uint8Array): void {
  if (bytes.byteLength !== EMERALD_FLASH_SAVE_BYTES) {
    throw new Error(
      `source save must be exactly ${String(EMERALD_FLASH_SAVE_BYTES)} bytes; got ${String(bytes.byteLength)}`,
    );
  }
  const first = saveSlotPartyCount(bytes, 0);
  const second = saveSlotPartyCount(bytes, SAVE_SLOT_BYTES);
  const active =
    second === null || (first !== null && first.counter >= second.counter)
      ? first
      : second;
  if (active === null) {
    throw new Error(
      "source save has no valid slot containing SaveBlock1 party data",
    );
  }
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
