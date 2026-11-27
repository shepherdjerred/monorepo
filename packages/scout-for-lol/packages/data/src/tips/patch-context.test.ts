import { beforeAll, describe, expect, test } from "vitest";
import type { PatchChangeLine } from "#src/data-dragon/patch-changes-schema.ts";
import { ChampionIdSchema } from "#src/model/core/identifiers.ts";
import { loadChampionGrounding } from "#src/tips/grounding.ts";
import {
  CURRENT_GROUNDING_VERSION,
  computeTipInputHash,
} from "#src/tips/input-hash.ts";
import {
  describePatchChange,
  recentChampionChanges,
  recentPatches,
} from "#src/tips/patch-context.ts";
import { buildGeneralPrompt, describeMechanics } from "#src/tips/prompt.ts";
import type { ChampionGrounding } from "#src/tips/grounding.ts";
import type { GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";

const AHRI = ChampionIdSchema.parse(103);

function line(
  patch: string,
  date: string,
  championId: number,
  stat: string,
): PatchChangeLine {
  return {
    patch,
    date,
    subject: {
      kind: "champion",
      id: ChampionIdSchema.parse(championId),
      name: "X",
    },
    ability: { slot: "Q", name: "Orb of Deception" },
    stat,
    before: "40",
    after: "35",
    direction: "nerf",
  };
}

const LINES: PatchChangeLine[] = [
  line("26.20", "2026-10-06", 103, "Old"),
  line("26.21", "2026-10-20", 103, "Damage"),
  line("26.22", "2026-11-03", 1, "Other champion"),
  line("26.23", "2026-11-17", 103, "Cooldown"),
  line("26.22", "2026-11-03", 103, "Range"),
];

describe("recent patch changes", () => {
  test("the recent patches are the newest three by date", () => {
    expect(recentPatches(LINES)).toEqual(["26.23", "26.22", "26.21"]);
  });

  test("a champion's recent lines are newest patch first and leave older patches out", () => {
    expect(
      recentChampionChanges(AHRI, LINES).map((entry) => entry.stat),
    ).toEqual(["Cooldown", "Range", "Damage"]);
  });

  test("a line reads as the ability, the stat and both values", () => {
    const [first] = LINES;
    expect(first && describePatchChange(first)).toBe(
      "26.20 Orb of Deception (Q), Old: 40 -> 35",
    );
  });
});

describe("the version 2 grounding", () => {
  let ahri: ChampionGrounding;

  beforeAll(async () => {
    ahri = await loadChampionGrounding(AHRI);
  });

  test("carries CommunityDragon mechanics and the champion's recent changes into the prompt", () => {
    const orb = ahri.facts.abilities.Q.mechanics;
    expect(orb?.missiles.some((entry) => entry.name === "ahriqmissile")).toBe(
      true,
    );
    expect(describeMechanics(orb)).toContain(
      "has no end-on-hit behavior, so it keeps going after a hit",
    );
    const charm = describeMechanics(ahri.facts.abilities.E.mechanics);
    expect(charm).toContain("ends at the first unit it hits");

    const { prompt } = buildGeneralPrompt({
      lane: "middle",
      champion: { ...ahri, recentChanges: LINES.slice(0, 2) },
      glossary: new Map<GlossaryId, GlossaryEntry>(),
    });
    expect(prompt).toContain("Mechanics:");
    expect(prompt).toContain("changes in the recent patches");
    expect(prompt).toContain("26.21 Orb of Deception (Q), Damage: 40 -> 35");
  });

  test("the hash covers mechanics and recent changes only from version 2, so older sets keep their hash", () => {
    const unit = {
      kind: "general",
      lane: "middle",
      championIds: [AHRI],
    } as const;
    const withoutChanges = { ...ahri, recentChanges: [] };
    const withChanges = { ...ahri, recentChanges: LINES.slice(0, 2) };
    const v1 = computeTipInputHash("tips-1", unit, [withoutChanges], {
      groundingVersion: 1,
    });
    expect(
      computeTipInputHash("tips-1", unit, [withChanges], {
        groundingVersion: 1,
      }),
    ).toBe(v1);
    expect(computeTipInputHash("tips-1", unit, [withChanges])).toBe(v1);

    const v2 = computeTipInputHash("tips-2", unit, [withoutChanges], {
      groundingVersion: 2,
    });
    expect(
      computeTipInputHash("tips-2", unit, [withChanges], {
        groundingVersion: 2,
      }),
    ).not.toBe(v2);
    const edited = structuredClone(withoutChanges);
    edited.facts.abilities.Q.mechanics = {
      targeting: null,
      castTime: null,
      radius: null,
      lineWidth: null,
      missileSpeed: 1,
      missiles: [],
    };
    expect(
      computeTipInputHash("tips-2", unit, [edited], {
        groundingVersion: 2,
      }),
    ).not.toBe(v2);
    expect(CURRENT_GROUNDING_VERSION).toBe(2);
  });
});
