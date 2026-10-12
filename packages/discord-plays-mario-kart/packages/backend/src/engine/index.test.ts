import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertEepromIntact,
  migrateLegacyEeprom,
  MK64_SAVE_HISTORY_ENTRIES,
  SPAGHETTI_HOME_DIR,
} from "./index.ts";

describe("assertEepromIntact", () => {
  let sessionDir: string;
  beforeEach(async () => {
    sessionDir = await mkdtemp(path.join(tmpdir(), "mk64-eeprom-"));
    await mkdir(path.join(sessionDir, SPAGHETTI_HOME_DIR));
  });
  afterEach(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  test("accepts a guild with no save yet", async () => {
    await expect(assertEepromIntact(sessionDir)).resolves.toBeUndefined();
  });

  test("accepts a complete 512-byte EEPROM image", async () => {
    await writeFile(
      path.join(sessionDir, SPAGHETTI_HOME_DIR, "default.sav"),
      new Uint8Array(512),
    );
    await expect(assertEepromIntact(sessionDir)).resolves.toBeUndefined();
  });

  test("refuses a truncated EEPROM image", async () => {
    await writeFile(
      path.join(sessionDir, SPAGHETTI_HOME_DIR, "default.sav"),
      new Uint8Array(0),
    );
    await expect(assertEepromIntact(sessionDir)).rejects.toThrow(
      /wrong size \(0 bytes, expected 512\)/,
    );
  });
});

describe("MK64_SAVE_HISTORY_ENTRIES", () => {
  test("covers the EEPROM and every controller-pak file in the game home", () => {
    expect(MK64_SAVE_HISTORY_ENTRIES).toContain(
      path.join(SPAGHETTI_HOME_DIR, "default.sav"),
    );
    expect(MK64_SAVE_HISTORY_ENTRIES).toContain(
      path.join(SPAGHETTI_HOME_DIR, "controllerPak_header.sav"),
    );
    expect(MK64_SAVE_HISTORY_ENTRIES).toContain(
      path.join(SPAGHETTI_HOME_DIR, "controllerPak_file_15.sav"),
    );
    expect(MK64_SAVE_HISTORY_ENTRIES).toHaveLength(18);
  });
});

describe("migrateLegacyEeprom", () => {
  let sessionDir: string;
  const eeprom = () => path.join(sessionDir, SPAGHETTI_HOME_DIR, "default.sav");
  const legacy = () => path.join(sessionDir, "emulator", "game.savememory");

  beforeEach(async () => {
    sessionDir = await mkdtemp(path.join(tmpdir(), "mk64-migrate-"));
    await mkdir(path.join(sessionDir, "emulator"));
  });
  afterEach(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  test("copies the EEPROM bytes out of the wasm save blob once", async () => {
    const blob = new Uint8Array(296_960).fill(0xff);
    for (let i = 0; i < 512; i++) blob[i] = i % 251;
    await writeFile(legacy(), blob);

    expect(await migrateLegacyEeprom(sessionDir)).toBe(true);
    const migrated = new Uint8Array(await readFile(eeprom()));
    expect(migrated).toEqual(blob.slice(0, 512));
    // The legacy blob stays; a second session does not migrate again.
    const kept = await readFile(legacy());
    expect(kept.length).toBe(296_960);
    expect(await migrateLegacyEeprom(sessionDir)).toBe(false);
  });

  test("never replaces an existing native EEPROM", async () => {
    await writeFile(legacy(), new Uint8Array(296_960));
    await mkdir(path.join(sessionDir, SPAGHETTI_HOME_DIR));
    await writeFile(eeprom(), new Uint8Array(512).fill(7));

    expect(await migrateLegacyEeprom(sessionDir)).toBe(false);
    expect(new Uint8Array(await readFile(eeprom()))).toEqual(
      new Uint8Array(512).fill(7),
    );
  });

  test("does nothing for a guild without a legacy save", async () => {
    expect(await migrateLegacyEeprom(sessionDir)).toBe(false);
  });

  test("refuses a wrong-size legacy blob", async () => {
    await writeFile(legacy(), new Uint8Array(1000));
    await expect(migrateLegacyEeprom(sessionDir)).rejects.toThrow(
      /refusing to migrate/,
    );
  });
});
