import { beforeAll, describe, expect, test } from "vitest";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { getChampionById } from "#src/model/riot/champion-registry.ts";
import {
  type StoredUnit,
  buildChampionFiles,
  buildIndex,
  fileIssues,
} from "#src/tips/output/champion-output.ts";
import { ChampionTipsFileSchema } from "#src/tips/output/champion-tips.ts";
import {
  type FactIndex,
  type RefContext,
  loadFactIndex,
  refsFor,
  validateRefs,
} from "#src/tips/output/refs.ts";
import type { GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";

const AHRI = ChampionIdSchema.parse(103);
const SYNDRA = ChampionIdSchema.parse(134);
const HASH = "a".repeat(64);
const META = {
  patch: "16.23",
  model: "claude-sonnet-5-5",
  promptVersion: "tips-4",
};

let context: RefContext;
let index: FactIndex;

beforeAll(async () => {
  index = await loadFactIndex(["charm"]);
  context = {
    index,
    glossary: new Map<GlossaryId, GlossaryEntry>(),
    championKeyOf: (id) => getChampionById(ChampionIdSchema.parse(id))?.key,
  };
});

const TEXT = "Dodge Syndra's stun with Flash, then Charm her as she walks up.";
const CITES = [
  {
    kind: "ability" as const,
    champion: AHRI,
    slot: "E" as const,
    name: "Charm",
  },
];

describe("references in a tip's text", () => {
  test("cover a cited ability, a summoner spell and a champion, each with its span", () => {
    const refs = refsFor(TEXT, CITES, context);
    expect(
      refs.map((ref) => [ref.kind, ref.key, TEXT.slice(ref.start, ref.end)]),
    ).toEqual([
      ["champion", "Syndra", "Syndra"],
      ["summoner-spell", "4", "Flash"],
      ["ability", "Ahri-E", "Charm"],
    ]);
    expect(validateRefs(TEXT, refs, index)).toEqual([]);
  });

  test("do not match a lowercase word for the spell, and a reference to a missing fact fails", () => {
    expect(
      refsFor("Use the flash of light to look.", [], context).map(
        (ref) => ref.kind,
      ),
    ).toEqual([]);
    expect(
      validateRefs(
        "Ahri",
        [{ kind: "champion", key: "Nobody", start: 0, end: 4 }],
        index,
      ).length,
    ).toBe(1);
    expect(
      validateRefs(
        "Ahri",
        [{ kind: "champion", key: "Ahri", start: 0, end: 9 }],
        index,
      ).length,
    ).toBe(1);
  });
});

const UNIT: StoredUnit = {
  id: "middle:Ahri-vs-Syndra",
  lane: "middle",
  inputHash: HASH,
  sets: [
    {
      subjectKey: "Ahri",
      opponentKey: "Syndra",
      tips: [
        { id: "t1", text: TEXT, cites: CITES, pWrong: 0.123, hidden: false },
      ],
      combos: [],
    },
    {
      subjectKey: "Syndra",
      opponentKey: "Ahri",
      tips: [
        {
          id: "t2",
          text: "Hold your stun for Ahri's dash.",
          cites: [],
          pWrong: 0.9,
          hidden: true,
        },
      ],
      combos: [],
    },
  ],
};

describe("the per-champion files", () => {
  test("group a pair's two directions into each subject's file, with rounded scores and hidden tips kept", () => {
    const { files, failed } = buildChampionFiles([UNIT], META, context);
    expect(failed).toEqual([]);
    expect([...files.keys()]).toEqual(["Ahri", "Syndra"]);
    const ahri = ChampionTipsFileSchema.parse(files.get("Ahri"));
    expect(ahri.matchups[0]?.opponent).toBe("Syndra");
    expect(ahri.matchups[0]?.tips[0]?.pWrong).toBe(0.12);
    expect(files.get("Syndra")?.matchups[0]?.tips[0]?.hidden).toBe(true);
    expect(fileIssues(ahri, index)).toEqual([]);
    const sizes = new Map([
      ["Ahri", 100],
      ["Syndra", 90],
    ]);
    const built = buildIndex(files, sizes, META);
    expect(
      built.champions.map((entry) => [entry.key, entry.tips, entry.hiddenTips]),
    ).toEqual([
      ["Ahri", 1, 0],
      ["Syndra", 1, 1],
    ]);
  });

  test("orders the index by code unit, not by locale, so a plain sort of the files matches it", () => {
    const { files } = buildChampionFiles([UNIT], META, context);
    const ahri = files.get("Ahri");
    if (ahri === undefined) {
      throw new Error("the fixture has no Ahri file");
    }
    const built = buildIndex(
      new Map([
        ["Kaisa", ahri],
        ["KSante", ahri],
      ]),
      new Map([
        ["Kaisa", 1],
        ["KSante", 1],
      ]),
      META,
    );
    expect(built.champions.map((entry) => entry.key)).toEqual([
      "KSante",
      "Kaisa",
    ]);
  });

  test("a unit whose reference does not resolve fails whole and is left out", () => {
    const broken: StoredUnit = {
      ...UNIT,
      sets: [
        {
          subjectKey: "Ahri",
          opponentKey: "Syndra",
          tips: [
            {
              id: "t3",
              text: "Use Nothing here.",
              cites: [
                { kind: "ability", champion: AHRI, slot: "Q", name: "Nothing" },
                {
                  kind: "ability",
                  champion: SYNDRA,
                  slot: "R",
                  name: "Nothing",
                },
              ],
              pWrong: 0,
              hidden: false,
            },
          ],
          combos: [],
        },
      ],
    };
    const noKeys = { ...context, championKeyOf: () => "Nobody" };
    const { files, failed } = buildChampionFiles([broken], META, noKeys);
    expect(files.size).toBe(0);
    expect(failed[0]?.issues.join(" ")).toContain("resolves to no game fact");
  });
});

const COMBO = {
  id: "middle:Ahri:combo:0",
  name: "Charm catch",
  category: "trick" as const,
  sequence: [{ kind: "ability" as const, champion: AHRI, slot: "E" as const }],
  when: "Use it when the target will not stand still.",
  text: "Land Charm first, then follow up while they walk toward you.",
};

const WITH_COMBO: StoredUnit = {
  id: "middle:Ahri",
  lane: "middle",
  inputHash: HASH,
  sets: [
    {
      subjectKey: "Ahri",
      tips: [
        {
          id: "g1",
          text: "Hold Charm for a caster.",
          cites: [],
          pWrong: 0.1,
          hidden: false,
        },
      ],
      combos: [
        {
          combo: COMBO,
          cites: [
            { kind: "ability", champion: AHRI, slot: "E", name: "Charm" },
          ],
        },
      ],
    },
  ],
};

const refUnit = (comboId: string): StoredUnit => ({
  ...UNIT,
  sets: [
    {
      ...(UNIT.sets[0] ?? { subjectKey: "Ahri", tips: [], combos: [] }),
      comboRefs: [
        {
          comboId,
          note: "Charm catches Syndra before her stun is ready.",
          cites: [
            { kind: "ability", champion: AHRI, slot: "E", name: "Charm" },
          ],
        },
      ],
    },
    ...UNIT.sets.slice(1),
  ],
});

describe("a matchup side's combo references", () => {
  test("point at a combo of the same champion in the same lane, and link the note's words", () => {
    const { files, failed } = buildChampionFiles(
      [WITH_COMBO, refUnit(COMBO.id)],
      META,
      context,
    );
    expect(failed).toEqual([]);
    const ahri = ChampionTipsFileSchema.parse(files.get("Ahri"));
    const ref = ahri.matchups[0]?.comboRefs[0];
    expect(ref?.comboId).toBe(COMBO.id);
    expect(ref?.refs.map((entry) => [entry.kind, entry.key])).toEqual([
      ["ability", "Ahri-E"],
      ["champion", "Syndra"],
    ]);
    expect(fileIssues(ahri, index)).toEqual([]);
  });

  test("fail the unit when the combo does not exist, and fail the file check when a written file points at a missing one", () => {
    const { failed } = buildChampionFiles(
      [WITH_COMBO, refUnit("middle:Ahri:combo:9")],
      META,
      context,
    );
    expect(failed[0]?.issues.join(" ")).toContain(
      "not a combo of this champion",
    );
    const { files } = buildChampionFiles(
      [WITH_COMBO, refUnit(COMBO.id)],
      META,
      context,
    );
    const ahri = ChampionTipsFileSchema.parse(
      structuredClone(files.get("Ahri")),
    );
    const side = ahri.matchups[0];
    if (side === undefined) {
      throw new Error("no matchup side");
    }
    side.comboRefs[0] = {
      ...(side.comboRefs[0] ?? { note: "x", refs: [] }),
      comboId: "middle:Ahri:combo:9",
      note: "x",
      refs: [],
    };
    expect(fileIssues(ahri, index).join(" ")).toContain("does not exist");
  });
});
