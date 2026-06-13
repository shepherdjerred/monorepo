import { parsePartyMon, PARTY_MON_SIZE } from "./pokemon-struct.ts";

// Mirror of the parser's permutation table (Growth/Attacks/EVs/Misc position
// per personality % 24), used by the encoder helper below. Pinned here so the
// test is not merely a tautology against the parser — these rows are the
// documented Gen-3 substruct orders.
const POSITIONS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
  [0, 2, 3, 1],
  [0, 3, 2, 1],
  [1, 0, 2, 3],
  [1, 0, 3, 2],
  [2, 0, 1, 3],
  [3, 0, 1, 2],
  [2, 0, 3, 1],
  [3, 0, 2, 1],
  [1, 2, 0, 3],
  [1, 3, 0, 2],
  [2, 1, 0, 3],
  [3, 1, 0, 2],
  [2, 3, 0, 1],
  [3, 2, 0, 1],
  [1, 2, 3, 0],
  [1, 3, 2, 0],
  [2, 1, 3, 0],
  [3, 1, 2, 0],
  [2, 3, 1, 0],
  [3, 2, 1, 0],
];

type MonFields = {
  personality: number;
  otId: number;
  species: number;
  level: number;
  hp: number;
  maxHp: number;
  isEgg?: boolean;
  nickname?: number[];
};

// Build a 100-byte party Pokémon the way the game does: write the Growth
// substruct (species), order the four substructs by personality % 24, compute
// the checksum over the decrypted substructs, then XOR-encrypt with the key.
function buildMon(fields: MonFields, corrupt = false): Uint8Array {
  const bytes = new Uint8Array(PARTY_MON_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, fields.personality >>> 0, true);
  view.setUint32(4, fields.otId >>> 0, true);
  if (fields.nickname) bytes.set(fields.nickname, 8);
  let flags = 0b010; // hasSpecies
  if (fields.isEgg) flags |= 0b100;
  view.setUint8(19, flags);
  view.setUint8(84, fields.level);
  view.setUint16(86, fields.hp, true);
  view.setUint16(88, fields.maxHp, true);

  // Decrypted 48-byte substruct region: Growth substruct holds species @0.
  const sub = new DataView(new ArrayBuffer(48));
  const positions = POSITIONS[fields.personality % 24];
  if (positions === undefined) throw new Error("bad personality");
  sub.setUint16(positions[0] * 12, fields.species, true);

  let checksum = 0;
  for (let i = 0; i < 24; i++) {
    checksum = (checksum + sub.getUint16(i * 2, true)) & 0xff_ff;
  }
  view.setUint16(28, corrupt ? (checksum ^ 0xff_ff) & 0xff_ff : checksum, true);

  const key = (fields.personality ^ fields.otId) >>> 0;
  for (let i = 0; i < 12; i++) {
    view.setUint32(32 + i * 4, (sub.getUint32(i * 4, true) ^ key) >>> 0, true);
  }
  return bytes;
}

describe("parsePartyMon", () => {
  test("round-trips species/level/hp through encryption", () => {
    const mon = parsePartyMon(
      buildMon({
        personality: 0x12_34_56_78,
        otId: 0x9a_bc_de_f0,
        species: 277, // Treecko (internal)
        level: 5,
        hp: 18,
        maxHp: 19,
      }),
    );
    expect(mon).not.toBeNull();
    expect(mon?.species).toBe(277);
    expect(mon?.level).toBe(5);
    expect(mon?.hp).toBe(18);
    expect(mon?.maxHp).toBe(19);
    expect(mon?.isEgg).toBe(false);
  });

  test("decodes across multiple permutation rows", () => {
    // Personalities chosen to land on different rows of the order table.
    for (const personality of [0, 1, 5, 6, 12, 23, 100, 0xff_ff_ff_ff]) {
      const mon = parsePartyMon(
        buildMon({
          personality,
          otId: 42,
          species: 300,
          level: 50,
          hp: 1,
          maxHp: 100,
        }),
      );
      expect(mon?.species).toBe(300);
      expect(mon?.level).toBe(50);
    }
  });

  test("rejects a corrupted checksum (torn read)", () => {
    const mon = parsePartyMon(
      buildMon(
        { personality: 7, otId: 7, species: 5, level: 5, hp: 5, maxHp: 5 },
        true,
      ),
    );
    expect(mon).toBeNull();
  });

  test("rejects an out-of-range species", () => {
    const mon = parsePartyMon(
      buildMon({
        personality: 3,
        otId: 9,
        species: 9999,
        level: 5,
        hp: 5,
        maxHp: 5,
      }),
    );
    expect(mon).toBeNull();
  });

  test("rejects empty slots (hasSpecies clear)", () => {
    expect(parsePartyMon(new Uint8Array(PARTY_MON_SIZE))).toBeNull();
  });

  test("flags an egg", () => {
    const mon = parsePartyMon(
      buildMon({
        personality: 2,
        otId: 2,
        species: 1,
        level: 5,
        hp: 5,
        maxHp: 5,
        isEgg: true,
      }),
    );
    expect(mon?.isEgg).toBe(true);
  });

  test("decodes the nickname charmap", () => {
    // 'P','I','K','A' = 0xBB+offsets; A=0xBB, then 0xFF terminator.
    const nickname = [0xca, 0xc3, 0xc5, 0xbb, 0xff];
    const mon = parsePartyMon(
      buildMon({
        personality: 4,
        otId: 4,
        species: 25,
        level: 5,
        hp: 5,
        maxHp: 5,
        nickname,
      }),
    );
    expect(mon?.nickname).toBe("PIKA");
  });

  test("returns null for wrong-sized input", () => {
    expect(parsePartyMon(new Uint8Array(50))).toBeNull();
  });
});

// Export the encoder so other tests (snapshot) can build party data.
export { buildMon };
