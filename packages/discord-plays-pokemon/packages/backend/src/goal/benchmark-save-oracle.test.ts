import { describe, expect, test } from "bun:test";
import { decodePersistedCatchState } from "./benchmark-save-oracle.ts";

const SAVE_SLOT_BYTES = 0xe0_00;
const SAVE_SECTOR_BYTES = 0x10_00;
const SAVE_SLOT_SECTORS = 14;
const SAVE_SECTOR_CHECKSUM_OFFSET = 0xf_f6;
const SAVE_SECTOR_COUNTER_OFFSET = 0xf_fc;
const MAX_SAVE_COUNTER = 0xff_ff_ff_ff;

async function fixture(name: string): Promise<Uint8Array> {
  return await Bun.file(
    new URL(`../game/events/testdata/${name}`, import.meta.url),
  ).bytes();
}

function setSlotCounter(
  view: DataView,
  slotOffset: number,
  counter: number,
): void {
  for (let sector = 0; sector < SAVE_SLOT_SECTORS; sector += 1) {
    view.setUint32(
      slotOffset + sector * SAVE_SECTOR_BYTES + SAVE_SECTOR_COUNTER_OFFSET,
      counter,
      true,
    );
  }
}

describe("decodePersistedCatchState", () => {
  test("independently decodes party identities and Dex bits from a real save", async () => {
    const result = decodePersistedCatchState(
      await fixture("after_starter.sav"),
    );

    expect(result.party.map((mon) => mon.species)).toEqual([280, 328]);
    expect(result.dexOwned).toHaveLength(52);
  });

  test("decodes all six identities from a full-party save", async () => {
    const result = decodePersistedCatchState(await fixture("champion.sav"));

    expect(result.party).toHaveLength(6);
    expect(result.party.map((mon) => mon.species)).toEqual([
      329, 292, 282, 369, 376, 151,
    ]);
  });

  test("rejects flash images without a complete active save slot", async () => {
    const bytes = Uint8Array.from(await fixture("after_starter.sav"));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(0xf_f8, 0, true);
    view.setUint32(0xe0_00 + 0xf_f8, 0, true);

    expect(() => decodePersistedCatchState(bytes)).toThrow(
      "persisted save oracle found no complete active save slot",
    );
  });

  test("rejects flash slots with corrupted logical-data checksums", async () => {
    const bytes = Uint8Array.from(await fixture("after_starter.sav"));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(
      SAVE_SECTOR_CHECKSUM_OFFSET,
      view.getUint16(SAVE_SECTOR_CHECKSUM_OFFSET, true) ^ 1,
      true,
    );
    view.setUint16(
      SAVE_SLOT_BYTES + SAVE_SECTOR_CHECKSUM_OFFSET,
      view.getUint16(SAVE_SLOT_BYTES + SAVE_SECTOR_CHECKSUM_OFFSET, true) ^ 1,
      true,
    );

    expect(() => decodePersistedCatchState(bytes)).toThrow(
      "persisted save oracle found no complete active save slot",
    );
  });

  test("selects counter zero over max counter at the exact rollover", async () => {
    const roomy = await fixture("after_starter.sav");
    const full = await fixture("champion.sav");
    const bytes = new Uint8Array(128 * 1024);
    bytes.set(full.subarray(0, SAVE_SLOT_BYTES), 0);
    bytes.set(
      roomy.subarray(SAVE_SLOT_BYTES, SAVE_SLOT_BYTES * 2),
      SAVE_SLOT_BYTES,
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    setSlotCounter(view, 0, MAX_SAVE_COUNTER);
    setSlotCounter(view, SAVE_SLOT_BYTES, 0);

    expect(decodePersistedCatchState(bytes).party).toHaveLength(2);

    setSlotCounter(view, 0, 0);
    setSlotCounter(view, SAVE_SLOT_BYTES, MAX_SAVE_COUNTER);
    expect(decodePersistedCatchState(bytes).party).toHaveLength(6);
  });

  test("does not depend on the target emulator snapshot reader", async () => {
    const source = await Bun.file(
      new URL("benchmark-save-oracle.ts", import.meta.url),
    ).text();

    expect(source).not.toContain("readGameSnapshot");
    expect(source).not.toContain("Emulator");
  });
});
