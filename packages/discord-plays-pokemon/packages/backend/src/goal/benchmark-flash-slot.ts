export const EMERALD_FLASH_SAVE_BYTES = 128 * 1024;

const SLOT_SECTORS = 14;
const SECTOR_BYTES = 0x10_00;
const SLOT_BYTES = SLOT_SECTORS * SECTOR_BYTES;
const SECTOR_DATA_BYTES = 0xf_80;
const SECTOR_ID_OFFSET = 0xf_f4;
const SECTOR_CHECKSUM_OFFSET = 0xf_f6;
const SECTOR_SIGNATURE_OFFSET = 0xf_f8;
const SECTOR_COUNTER_OFFSET = 0xf_fc;
const SECTOR_SIGNATURE = 0x08_01_20_25;
const MAX_COUNTER = 0xff_ff_ff_ff;

type SaveLayout = Readonly<{
  name: "classic-gba" | "pinned-wasm32";
  chunkSizes: readonly number[];
}>;

const CLASSIC_GBA_LAYOUT: SaveLayout = {
  name: "classic-gba",
  chunkSizes: [
    0xf_2c, 0xf_80, 0xf_80, 0xf_80, 0xf_08, 0xf_80, 0xf_80, 0xf_80, 0xf_80,
    0xf_80, 0xf_80, 0xf_80, 0xf_80, 0x7_d0,
  ],
};

const PINNED_WASM32_LAYOUT: SaveLayout = {
  name: "pinned-wasm32",
  chunkSizes: [
    0xf_08, 0xf_80, 0xf_80, 0xf_80, 0xd_c0, 0xf_80, 0xf_80, 0xf_80, 0xf_80,
    0xf_80, 0xf_80, 0xf_80, 0xf_80, 0x7_d0,
  ],
};

const SAVE_LAYOUTS: readonly SaveLayout[] = [
  CLASSIC_GBA_LAYOUT,
  PINNED_WASM32_LAYOUT,
];

type PhysicalSector = Readonly<{
  id: number;
  data: Uint8Array;
  storedChecksum: number;
}>;

export type ValidatedEmeraldSaveSlot = Readonly<{
  counter: number;
  layout: SaveLayout["name"];
  sectors: ReadonlyMap<number, Uint8Array>;
}>;

function calculateChecksum(bytes: Uint8Array, chunkSize: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  for (let offset = 0; offset < chunkSize; offset += 4) {
    sum = (sum + view.getUint32(offset, true)) >>> 0;
  }
  return ((sum >>> 16) + (sum & 0xff_ff)) & 0xff_ff;
}

function matchingLayout(
  physicalSectors: readonly PhysicalSector[],
): SaveLayout | null {
  for (const layout of SAVE_LAYOUTS) {
    const matches = physicalSectors.every((sector) => {
      const chunkSize = layout.chunkSizes[sector.id];
      return (
        chunkSize !== undefined &&
        calculateChecksum(sector.data, chunkSize) === sector.storedChecksum
      );
    });
    if (matches) return layout;
  }
  return null;
}

function readSlot(
  bytes: Uint8Array,
  slotOffset: number,
): ValidatedEmeraldSaveSlot | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const physicalSectors: PhysicalSector[] = [];
  const sectors = new Map<number, Uint8Array>();
  let counter: number | undefined;
  for (
    let physicalSector = 0;
    physicalSector < SLOT_SECTORS;
    physicalSector += 1
  ) {
    const offset = slotOffset + physicalSector * SECTOR_BYTES;
    if (
      view.getUint32(offset + SECTOR_SIGNATURE_OFFSET, true) !==
      SECTOR_SIGNATURE
    ) {
      return null;
    }
    const id = view.getUint16(offset + SECTOR_ID_OFFSET, true);
    const sectorCounter = view.getUint32(offset + SECTOR_COUNTER_OFFSET, true);
    if (
      id >= SLOT_SECTORS ||
      sectors.has(id) ||
      (counter !== undefined && counter !== sectorCounter)
    ) {
      return null;
    }
    const data = bytes.slice(offset, offset + SECTOR_DATA_BYTES);
    physicalSectors.push({
      id,
      data,
      storedChecksum: view.getUint16(offset + SECTOR_CHECKSUM_OFFSET, true),
    });
    sectors.set(id, data);
    counter = sectorCounter;
  }
  if (counter === undefined || sectors.size !== SLOT_SECTORS) return null;
  const layout = matchingLayout(physicalSectors);
  if (layout === null) return null;
  return { counter, layout: layout.name, sectors };
}

export function readValidatedEmeraldSaveSlots(bytes: Uint8Array): Readonly<{
  first: ValidatedEmeraldSaveSlot | null;
  second: ValidatedEmeraldSaveSlot | null;
}> {
  return {
    first: readSlot(bytes, 0),
    second: readSlot(bytes, SLOT_BYTES),
  };
}

export function selectActiveEmeraldSaveSlot(
  first: ValidatedEmeraldSaveSlot | null,
  second: ValidatedEmeraldSaveSlot | null,
): ValidatedEmeraldSaveSlot | null {
  if (first === null) return second;
  if (second === null) return first;
  if (first.counter === MAX_COUNTER && second.counter === 0) return second;
  if (first.counter === 0 && second.counter === MAX_COUNTER) return first;
  return first.counter >= second.counter ? first : second;
}
