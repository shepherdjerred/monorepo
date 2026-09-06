import { mkdtemp, mkdir, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildChampionAbilityFacts,
  cleanNumber,
  formatRankValues,
  generateAbilityFactsAssets,
  renderCalculation,
  resolveTooltip,
  stripTooltipMarkup,
} from "./ability-facts.ts";
import { ChampionAbilityFactsSchema } from "#src/data-dragon/ability-facts.ts";

const FIXTURE_BIN_PATH = `${import.meta.dirname}/fixtures/chogath.bin.json`;
const DDRAGON_CHOGATH_PATH = `${import.meta.dirname}/../src/data-dragon/assets/champion/Chogath.json`;

async function loadJson(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parsed;
}

describe("number formatting", () => {
  test("cleanNumber strips float32 noise without touching real decimals", () => {
    expect(cleanNumber(0.699999988079071)).toBe(0.7);
    expect(cleanNumber(3.200000047683716)).toBe(3.2);
    expect(cleanNumber(300)).toBe(300);
    expect(cleanNumber(0.025)).toBe(0.025);
  });

  test("cleanNumber snaps noise propagated through multiplication", () => {
    // 0.9 × float32(250.00001)-style products used to surface as 224.99999.
    expect(cleanNumber(224.99999)).toBe(225);
    expect(cleanNumber(144.00001)).toBe(144);
    expect(cleanNumber(300.00001)).toBe(300);
    expect(cleanNumber(900.00004)).toBe(900);
    // Genuine decimals survive the snapping.
    expect(cleanNumber(1.6)).toBe(1.6);
    expect(cleanNumber(0.0125)).toBe(0.0125);
  });

  test("cleanNumber preserves legitimate tiny coefficients (relative bound)", () => {
    // An absolute tolerance floor once zeroed Kayn's BonusHealRatio and
    // re-rounded Camille's ADRequiredTooltipOnly — both are real bin values.
    expect(cleanNumber(0.00005)).toBe(0.00005);
    expect(cleanNumber(0.00025)).toBe(0.00025);
    expect(cleanNumber(Math.fround(0.00005))).toBe(0.00005);
    expect(cleanNumber(Math.fround(0.00025))).toBe(0.00025);
    expect(cleanNumber(0)).toBe(0);
    // And large values keep their genuine decimals.
    expect(cleanNumber(10000.4)).toBe(10000.4);
    expect(cleanNumber(Math.fround(10000.4))).toBe(10000.4);
  });

  test("formatRankValues collapses constants and joins varying ranks", () => {
    expect(formatRankValues([300, 475, 650])).toBe("300/475/650");
    expect(formatRankValues([1200, 1200, 1200])).toBe("1200");
    expect(formatRankValues([0.5])).toBe("0.5");
  });
});

describe("stripTooltipMarkup", () => {
  test("removes markup tags but keeps their text", () => {
    expect(
      stripTooltipMarkup(
        "deals <trueDamage>300 true damage</trueDamage><br /><br />and <healing>heals</healing>",
      ),
    ).toBe("deals 300 true damage and heals");
  });

  test("removes Riot %i:...% icon markup", () => {
    expect(stripTooltipMarkup("gains %i:OnHit% On-Hit damage")).toBe(
      "gains On-Hit damage",
    );
    expect(stripTooltipMarkup("%i:scaleAPen% Armor Penetration")).toBe(
      "Armor Penetration",
    );
  });
});

describe("renderCalculation", () => {
  const context = {
    dataValues: new Map<string, readonly number[]>([
      // Raw bin layout: index 0 is rank 0 (unlearned), ranks are 1-indexed.
      ["basedamage", [50, 200, 350, 500, 500, 500, 500]],
      ["apratio", [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7]],
    ]),
    effectRanks: new Map<number, readonly number[]>(),
    calculations: new Map([
      [
        "totaldamage",
        {
          __type: "GameCalculation",
          mFormulaParts: [
            {
              __type: "NamedDataValueCalculationPart",
              mDataValue: "BaseDamage",
            },
            {
              __type: "StatByNamedDataValueCalculationPart",
              mDataValue: "APRatio",
            },
          ],
        },
      ],
    ]),
    maxRank: 3,
  };

  test("renders a base + AP-ratio calculation as rank string with scaling", () => {
    expect(renderCalculation("totaldamage", context)).toBe(
      "200/350/500 (+70% AP)",
    );
  });

  test("refuses a calculation containing an unknown part type", () => {
    const withUnknownPart = {
      ...context,
      calculations: new Map([
        [
          "mystery",
          {
            __type: "GameCalculation",
            mFormulaParts: [{ __type: "{deadbeef}", mSomething: 1 }],
          },
        ],
      ]),
    };
    expect(renderCalculation("mystery", withUnknownPart)).toBeUndefined();
  });

  test("renders numeric bases before stat scalings regardless of bin order", () => {
    const statFirst = {
      ...context,
      calculations: new Map([
        [
          "statfirst",
          {
            __type: "GameCalculation",
            mFormulaParts: [
              {
                __type: "StatByCoefficientCalculationPart",
                mCoefficient: 0.05,
              },
              {
                __type: "NamedDataValueCalculationPart",
                mDataValue: "BaseDamage",
              },
            ],
          },
        ],
      ]),
    };
    expect(renderCalculation("statfirst", statFirst)).toBe(
      "200/350/500 (+5% AP)",
    );
  });

  test("renders negative additive terms as subtraction", () => {
    const withNegative = {
      ...context,
      calculations: new Map([
        [
          "amplification",
          {
            __type: "GameCalculation",
            mDisplayAsPercent: true,
            mFormulaParts: [
              { __type: "NumberCalculationPart", mNumber: 1.4 },
              { __type: "NumberCalculationPart", mNumber: -1 },
            ],
          },
        ],
      ]),
    };
    expect(renderCalculation("amplification", withNegative)).toBe(
      "140% (-100%)",
    );
  });

  test("applies mInitialBonusPerLevel and default-0 breakpoint resets", () => {
    // Serialization drops default fields, so a bare {mLevel: 12} breakpoint
    // means "per-level growth becomes 0 at level 12" (Malzahar E's shape).
    const withGrowth = {
      ...context,
      calculations: new Map([
        [
          "growth",
          {
            __type: "GameCalculation",
            mFormulaParts: [
              {
                __type: "ByCharLevelBreakpointsCalculationPart",
                mLevel1Value: 10,
                mInitialBonusPerLevel: 2,
                mBreakpoints: [{ mLevel: 12 }],
              },
            ],
          },
        ],
      ]),
    };
    expect(renderCalculation("growth", withGrowth)).toBe(
      "10-30 (based on level)",
    );
  });

  test("folds a tooltip's trailing percent onto the base value", () => {
    const healContext = {
      ...context,
      calculations: new Map([
        [
          "healcalc",
          {
            __type: "GameCalculation",
            mFormulaParts: [
              { __type: "NumberCalculationPart", mNumber: 30 },
              {
                __type: "StatByCoefficientCalculationPart",
                mCoefficient: 0.05,
              },
            ],
          },
        ],
      ]),
    };
    const resolved = resolveTooltip("heals {{ healcalc }}% of damage dealt", {
      ddragonSpell: undefined,
      resourceName: "Mana",
      context: healContext,
      spellContextsByName: new Map(),
    });
    expect(resolved.text).toBe("heals 30% (+5% AP) of damage dealt");
    expect(resolved.unresolved).toEqual([]);
  });

  test("refuses an unknown stat id instead of guessing", () => {
    const withUnknownStat = {
      ...context,
      calculations: new Map([
        [
          "unknownstat",
          {
            __type: "GameCalculation",
            mFormulaParts: [
              {
                __type: "StatByCoefficientCalculationPart",
                mStat: 999,
                mCoefficient: 0.5,
              },
            ],
          },
        ],
      ]),
    };
    expect(renderCalculation("unknownstat", withUnknownStat)).toBeUndefined();
  });
});

describe("buildChampionAbilityFacts (committed Cho'Gath fixture bin)", () => {
  async function build() {
    return buildChampionAbilityFacts({
      championKey: "Chogath",
      ddragonChampionFile: await loadJson(DDRAGON_CHOGATH_PATH),
      bin: await loadJson(FIXTURE_BIN_PATH),
    });
  }

  test("R (Feast) carries rank-1-first data values", async () => {
    const { facts } = await build();
    const feast = facts.abilities.R;
    expect(feast.name).toBe("Feast");
    expect(feast.maxRank).toBe(3);
    // 1-based rank indexing: dataValues[name][0] is the RANK 1 value.
    expect(feast.dataValues["RBaseDamage"]).toEqual([300, 475, 650]);
    expect(feast.cooldownByRank).toEqual([80, 70, 60]);
    expect(feast.costByRank).toEqual([100, 100, 100]);
    expect(feast.costType).toBe("Mana");
    expect(feast.rangeByRank).toEqual([175, 175, 175]);
  });

  test("R tooltip resolves damage, scalings, and per-stack health", async () => {
    const { facts } = await build();
    const feast = facts.abilities.R;
    expect(feast.resolvedDescription).toContain(
      "300/475/650 (+50% AP) (+10% bonus Health) true damage",
    );
    expect(feast.resolvedDescription).toContain("80/120/160 max Health");
    expect(feast.resolvedDescription).not.toContain("{{");
    expect(feast.unresolved).toEqual([]);
  });

  test("W resolves its damage through the effect-value table", async () => {
    const { facts } = await build();
    // FeralScream's calc references the spell effect table (published by Data
    // Dragon as effectBurn), plus a default-stat (AP) coefficient part.
    expect(facts.abilities.W.resolvedDescription).toContain(
      "80/130/180/230/280 (+70% AP) magic damage",
    );
    expect(facts.abilities.W.unresolved).toEqual([]);
  });

  test("E keeps its per-stack calc as an unresolved token (never guesses)", async () => {
    const { facts } = await build();
    // VorpalSpikes' max-health percent scales per Feast stack via a buff
    // counter — not mechanically resolvable, so the token must survive.
    expect(facts.abilities.E.resolvedDescription).toContain(
      "{{ maxhealthpercentcalc }}",
    );
    expect(facts.abilities.E.unresolved).toEqual(["maxhealthpercentcalc"]);
  });

  test("every slot is present and finds its bin spell", async () => {
    const { facts, slotsWithoutBinSpell } = await build();
    expect(slotsWithoutBinSpell).toEqual([]);
    expect(Object.keys(facts.abilities).toSorted()).toEqual([
      "E",
      "Q",
      "R",
      "W",
      "passive",
    ]);
    expect(facts.abilities.passive.maxRank).toBe(1);
    expect(facts.abilities.passive.costType).toBe("No Cost");
  });

  test("output round-trips through the reader schema", async () => {
    const { facts } = await build();
    expect(() => ChampionAbilityFactsSchema.parse(facts)).not.toThrow();
  });
});

describe("generateAbilityFactsAssets (dry run against the fixture bin)", () => {
  async function makeAssetsDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "ability-facts-"));
    await mkdir(join(dir, "champion"), { recursive: true });
    await mkdir(join(dir, "ability-facts"), { recursive: true });
    await copyFile(DDRAGON_CHOGATH_PATH, join(dir, "champion", "Chogath.json"));
    return dir;
  }

  test("writes a schema-valid asset and reports coverage", async () => {
    const assetsDir = await makeAssetsDir();
    const lines: string[] = [];
    const coverage = await generateAbilityFactsAssets({
      championKeys: ["Chogath"],
      assetsDir,
      fetchBin: () => loadJson(FIXTURE_BIN_PATH),
      log: (line) => lines.push(line),
    });

    expect(coverage.championsProcessed).toBe(1);
    expect(coverage.abilitiesTotal).toBe(5);
    // Passive/Q/W/R resolve fully; E's per-stack calc stays unresolved.
    expect(coverage.abilitiesFullyResolved).toBe(4);
    expect(coverage.abilitiesWithUnresolved).toBe(1);
    expect([...coverage.unresolvedTokenCounts.keys()]).toEqual([
      "maxhealthpercentcalc",
    ]);

    const written: unknown = JSON.parse(
      await readFile(join(assetsDir, "ability-facts", "Chogath.json"), "utf8"),
    );
    const facts = ChampionAbilityFactsSchema.parse(written);
    expect(facts.championName).toBe("Cho'Gath");
    expect(lines.join("\n")).toContain("Ability-facts coverage:");
  });

  test("fails loudly when a champion bin cannot be fetched", async () => {
    const assetsDir = await makeAssetsDir();
    await expect(
      generateAbilityFactsAssets({
        championKeys: ["Chogath"],
        assetsDir,
        fetchBin: () => Promise.reject(new Error("simulated CDN outage")),
        log: () => undefined,
      }),
    ).rejects.toThrow("ability-facts generation failed for 1 champion(s)");
  });
});
