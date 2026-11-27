import { beforeAll, describe, expect, test } from "vitest";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { type Combo, ComboSchema } from "#src/tips/combos/combo-schema.ts";
import {
  isGenericSequence,
  isGenericWording,
  validateComboRefs,
  validateCombos,
} from "#src/tips/combos/combos.ts";
import { copyWords, sharedWordRun } from "#src/tips/copy-check.ts";
import {
  type ChampionGrounding,
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import type { GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";
import type { TipValidationContext } from "#src/tips/validate.ts";

const AHRI = ChampionIdSchema.parse(103);
const step = (slot: "P" | "Q" | "W" | "E" | "R") =>
  ({ kind: "ability", champion: AHRI, slot }) as const;

let ahri: ChampionGrounding;
let context: TipValidationContext;

beforeAll(async () => {
  ahri = await loadChampionGrounding(AHRI);
  context = {
    champions: [ahri],
    abilityIndex: await loadAbilityNameIndex(),
    glossary: new Map<GlossaryId, GlossaryEntry>(),
  };
});

const CHARM_CATCH: Combo = {
  id: "ahri:combo:0",
  name: "Charm catch",
  category: "combo",
  sequence: [step("E"), step("Q"), step("W")],
  when: "You want to trade with a target that will not stand still.",
  text: "Land Charm first, then Orb of Deception and Fox-Fire while they walk toward you.",
};

describe("combos", () => {
  test("an empty list is valid", () => {
    expect(validateCombos([], ahri, context)).toEqual([]);
  });

  test("a well-formed combo passes and parses", () => {
    expect(ComboSchema.safeParse(CHARM_CATCH).success).toBe(true);
    expect(validateCombos([CHARM_CATCH], ahri, context)).toEqual([]);
  });

  test("a slot used twice inside its cooldown is rejected unless the text says recast or later game", () => {
    const twice: Combo = { ...CHARM_CATCH, sequence: [step("E"), step("E")] };
    expect(
      validateCombos([twice], ahri, context).some((issue) =>
        issue.message.includes("rank 1 cooldown"),
      ),
    ).toBe(true);
    const later: Combo = {
      ...twice,
      text: "A later-game combo: Charm again once your cooldowns are short.",
    };
    expect(
      validateCombos([later], ahri, context).filter((issue) =>
        issue.message.includes("cooldown"),
      ),
    ).toEqual([]);
  });

  test("a statistic, an unknown item and a step from another champion are rejected", () => {
    const stat = { ...CHARM_CATCH, text: "Land Charm; it wins 55% of trades." };
    expect(
      validateCombos([stat], ahri, context).map((issue) => issue.code),
    ).toContain("statistic");
    const item: Combo = {
      ...CHARM_CATCH,
      sequence: [step("E"), { kind: "item", id: 3157, name: "Not Zhonya" }],
    };
    expect(
      validateCombos([item], ahri, context).map((issue) => issue.code),
    ).toContain("bad-cite");
    const foreign: Combo = {
      ...CHARM_CATCH,
      sequence: [
        step("E"),
        { kind: "ability", champion: ChampionIdSchema.parse(134), slot: "Q" },
      ],
    };
    expect(
      validateCombos([foreign], ahri, context).map((issue) => issue.code),
    ).toContain("bad-cite");
  });

  test("a combo needs two steps, a terrain spot needs none", () => {
    expect(
      validateCombos([{ ...CHARM_CATCH, sequence: [step("E")] }], ahri, context)
        .length,
    ).toBeGreaterThan(0);
    const wall: Combo = {
      id: "ahri:terrain:0",
      name: "River wall hop",
      category: "terrain",
      sequence: [],
      when: "You need to escape a gank toward the river.",
      text: "Dash over the thin wall between the river and the nearest camp.",
    };
    expect(validateCombos([wall], ahri, context)).toEqual([]);
  });

  test("references must point at known combos, at most three, with a plain note", () => {
    const ok = validateComboRefs(
      [
        {
          comboId: CHARM_CATCH.id,
          note: "Charm catches the target before it can trade back.",
        },
      ],
      [CHARM_CATCH],
      ahri,
      context,
    );
    expect(ok).toEqual([]);
    expect(
      validateComboRefs(
        [{ comboId: "nope", note: "A note." }],
        [CHARM_CATCH],
        ahri,
        context,
      ).map((issue) => issue.code),
    ).toEqual(["bad-cite"]);
    const many = Array.from({ length: 4 }, () => ({
      comboId: CHARM_CATCH.id,
      note: "A note.",
    }));
    expect(
      validateComboRefs(many, [CHARM_CATCH], ahri, context).some((issue) =>
        issue.message.includes("at most"),
      ),
    ).toBe(true);
  });
});

describe("the copy check", () => {
  const SOURCE =
    "Orb of Deception sends out and pulls back an orb, dealing magic damage on the way out and true damage on the way back.";

  test("finds a run of eight consecutive words shared with a source, ignoring case and punctuation", () => {
    expect(
      sharedWordRun(
        "Remember: it pulls back an ORB, dealing magic damage on the way out.",
        [SOURCE],
      ),
    ).toBe("pulls back an orb dealing magic damage on");
  });

  test("allows tips that only share short phrases", () => {
    expect(
      sharedWordRun(
        "Throw Orb of Deception across her path, then pull it back.",
        [SOURCE],
      ),
    ).toBeUndefined();
    expect(copyWords("Don't  stop!")).toEqual(["don't", "stop"]);
  });
});

describe("generic combos", () => {
  test("abilities in slot order with no named trick are generic", () => {
    expect(
      isGenericSequence({
        category: "combo",
        sequence: [step("Q"), step("W"), "attack", step("E")],
      }),
    ).toBe(true);
  });

  test("a trick, a summoner spell or item, a repeat or a different order is not", () => {
    expect(
      isGenericSequence({
        category: "trick",
        sequence: [step("Q"), step("W")],
      }),
    ).toBe(false);
    expect(
      isGenericSequence({
        category: "combo",
        sequence: [step("Q"), { kind: "spell", id: 4, name: "Flash" }],
      }),
    ).toBe(false);
    expect(
      isGenericSequence({
        category: "combo",
        sequence: [step("E"), step("Q")],
      }),
    ).toBe(false);
    expect(
      isGenericSequence({
        category: "combo",
        sequence: [step("Q"), step("Q")],
      }),
    ).toBe(false);
  });

  test("a full trade or all-in described as a combo or rotation is generic by its words; a trick is not held to it", () => {
    const base = {
      name: "Full trade rotation",
      when: "In a trade.",
      text: "Cast it.",
    };
    expect(isGenericWording({ ...base, category: "rotation" })).toBe(true);
    expect(
      isGenericWording({
        ...base,
        name: "Hop",
        text: "An all-in hop.",
        category: "trick",
      }),
    ).toBe(false);
  });

  test("validation rejects a generic combo", async () => {
    const generic: Combo = {
      id: "ahri:combo:9",
      name: "Standard combo",
      category: "combo",
      sequence: [step("Q"), step("W"), step("E")],
      when: "You are trading.",
      text: "Cast Orb of Deception, Fox-Fire and Charm in that order.",
    };
    expect(
      validateCombos([generic], ahri, context).some((issue) =>
        issue.message.includes("generic damage order"),
      ),
    ).toBe(true);
  });
});
