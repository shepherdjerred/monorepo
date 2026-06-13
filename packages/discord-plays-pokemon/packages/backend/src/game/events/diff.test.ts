import { diffSnapshots } from "./diff.ts";
import type { ParsedPartyMon } from "./pokemon-struct.ts";
import type { GameEvent, GameSnapshot } from "./types.ts";

function mon(overrides: Partial<ParsedPartyMon> = {}): ParsedPartyMon {
  return {
    personality: 1,
    otId: 1,
    species: 277,
    level: 5,
    hp: 20,
    maxHp: 20,
    isEgg: false,
    nickname: "MON",
    ...overrides,
  };
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    party: [],
    badges: [false, false, false, false, false, false, false, false],
    dexOwned: new Uint8Array(52),
    caughtMonSpecies: 0,
    caughtMonShiny: false,
    ...overrides,
  };
}

function kinds(events: GameEvent[]): string[] {
  return events.map((event) => event.kind);
}

describe("diffSnapshots", () => {
  test("faint: hp crosses to zero (with another mon alive, so not a whiteout)", () => {
    const ally = mon({ personality: 2, otId: 2, hp: 20 });
    const before = snapshot({ party: [mon({ hp: 5 }), ally] });
    const after = snapshot({ party: [mon({ hp: 0 }), ally] });
    const events = diffSnapshots(before, after);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "faint",
      species: 277,
      nickname: "MON",
      level: 5,
    });
  });

  test("revive does not fire", () => {
    const ally = mon({ personality: 2, otId: 2, hp: 20 });
    const before = snapshot({ party: [mon({ hp: 0 }), ally] });
    const after = snapshot({ party: [mon({ hp: 20 }), ally] });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });

  test("party reorder is inert (identity-keyed)", () => {
    const a = mon({ personality: 1, otId: 1, hp: 20 });
    const b = mon({ personality: 2, otId: 2, hp: 20 });
    const before = snapshot({ party: [a, b] });
    const after = snapshot({ party: [b, a] });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });

  test("PC deposit (mon disappears) does not fire a faint", () => {
    const before = snapshot({
      party: [mon({ hp: 20 }), mon({ personality: 2, otId: 2 })],
    });
    const after = snapshot({ party: [mon({ personality: 2, otId: 2 })] });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });

  test("withdraw/new mon appearing does not fire", () => {
    const before = snapshot({ party: [mon()] });
    const after = snapshot({
      party: [mon(), mon({ personality: 99, otId: 99 })],
    });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });

  test("trade (identity swap) does not fire faint/evolution", () => {
    const before = snapshot({
      party: [mon({ personality: 1, otId: 1, species: 277, hp: 20 })],
    });
    const after = snapshot({
      party: [mon({ personality: 5, otId: 5, species: 280, hp: 20 })],
    });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });

  test("evolution: same identity, new species", () => {
    const before = snapshot({ party: [mon({ species: 277 })] });
    const after = snapshot({ party: [mon({ species: 278 })] });
    expect(kinds(diffSnapshots(before, after))).toContain("evolution");
  });

  test("whiteout suppresses individual faints and fires once", () => {
    const before = snapshot({
      party: [
        mon({ personality: 1, otId: 1, hp: 5 }),
        mon({ personality: 2, otId: 2, hp: 5 }),
      ],
    });
    const after = snapshot({
      party: [
        mon({ personality: 1, otId: 1, hp: 0 }),
        mon({ personality: 2, otId: 2, hp: 0 }),
      ],
    });
    const events = diffSnapshots(before, after);
    expect(kinds(events)).toEqual(["whiteout"]);
  });

  test("whiteout requires a non-empty party (load gap is not a whiteout)", () => {
    const before = snapshot({ party: [mon({ hp: 5 })] });
    const after = snapshot({ party: [] });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });

  test("badge: flag flips 0 to 1", () => {
    const before = snapshot();
    const badges = [true, false, false, false, false, false, false, false];
    const after = snapshot({ badges });
    const events = diffSnapshots(before, after);
    expect(events).toEqual([{ kind: "badge", badgeIndex: 0 }]);
  });

  test("catch: caughtMonSpecies 0 to X", () => {
    const before = snapshot({ caughtMonSpecies: 0 });
    const after = snapshot({ caughtMonSpecies: 263, caughtMonShiny: true });
    expect(diffSnapshots(before, after)).toEqual([
      { kind: "catch", species: 263, shiny: true },
    ]);
  });

  test("catch: X to Y (consecutive battles, no observed zero)", () => {
    const before = snapshot({ caughtMonSpecies: 263 });
    const after = snapshot({ caughtMonSpecies: 265 });
    expect(kinds(diffSnapshots(before, after))).toEqual(["catch"]);
  });

  test("catch: unchanged value does not refire", () => {
    const before = snapshot({ caughtMonSpecies: 263 });
    const after = snapshot({ caughtMonSpecies: 263 });
    expect(diffSnapshots(before, after)).toHaveLength(0);
  });

  test("level up coalesces multiple levels into one event", () => {
    const before = snapshot({ party: [mon({ level: 5 })] });
    const after = snapshot({ party: [mon({ level: 8 })] });
    expect(diffSnapshots(before, after)).toEqual([
      {
        kind: "levelUp",
        species: 277,
        nickname: "MON",
        fromLevel: 5,
        toLevel: 8,
      },
    ]);
  });

  test("new dex bit -> dexEntry with national number", () => {
    const before = snapshot();
    const dexOwned = new Uint8Array(52);
    dexOwned[0] = 0b0000_0001; // bit 0 => national #1
    const after = snapshot({ dexOwned });
    expect(diffSnapshots(before, after)).toEqual([
      { kind: "dexEntry", nationalDexNumber: 1 },
    ]);
  });

  test("dex bit at byte 1 bit 3 -> national #12", () => {
    const before = snapshot();
    const dexOwned = new Uint8Array(52);
    dexOwned[1] = 0b0000_1000; // byte 1, bit 3 => 8 + 3 + 1 = 12
    const after = snapshot({ dexOwned });
    expect(diffSnapshots(before, after)).toEqual([
      { kind: "dexEntry", nationalDexNumber: 12 },
    ]);
  });

  test("flood of events from a save reload is reported (watcher drops it)", () => {
    // 8 badges + several dex bits in one diff > MAX_EVENTS_PER_DIFF.
    const before = snapshot();
    const dexOwned = new Uint8Array(52);
    dexOwned[0] = 0xff;
    const after = snapshot({
      badges: Array.from({ length: 8 }).fill(true),
      dexOwned,
    });
    expect(diffSnapshots(before, after).length).toBeGreaterThan(10);
  });
});
