import { describe, expect, test } from "vitest";
import { COACH_CONTEXT_SECTIONS } from "@scout-for-lol/data";
import { z } from "zod";
import fixtures from "@scout-for-lol/data/scout-client/coach-context.fixtures.json" with { type: "json" };
import {
  CoachTurnInitiationSchema,
  PLAYER_INITIATIONS,
  projectGameContext,
  type CoachPolicyFlags,
  type CoachTurnInitiation,
} from "./context-policy.ts";

const JsonObjectSchema = z.record(z.string(), z.unknown());
const complete = JsonObjectSchema.parse(fixtures.valid[0]?.body);

const INITIATIONS = CoachTurnInitiationSchema.options;
const FLAG_STATES: readonly CoachPolicyFlags[] = [false, true].flatMap(
  (coachEnabled) =>
    [false, true].map((liveAnswersEnabled) => ({
      coachEnabled,
      liveAnswersEnabled,
    })),
);

/** A small seeded generator, so a failure names a reproducible case. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A context of a random non-empty subset of sections, taken from the complete fixture. */
function generatedContext(next: () => number): Record<string, unknown> {
  const sections = COACH_CONTEXT_SECTIONS.filter(() => next() < 0.5);
  const chosen = sections.length > 0 ? sections : ["live" as const];
  return Object.fromEntries(
    chosen.map((section) => [section, structuredClone(complete[section])]),
  );
}

/**
 * A JSON object, by reference: `z.record` would parse a copy, and the test
 * changes the object in place.
 */
const SameObjectSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
);

/** Every object inside a JSON value, the value itself included. */
function objectsIn(value: unknown): Record<string, unknown>[] {
  const array = z.array(z.unknown()).safeParse(value);
  if (array.success) return array.data.flatMap((entry) => objectsIn(entry));
  const object = SameObjectSchema.safeParse(value);
  return object.success
    ? [
        object.data,
        ...Object.values(object.data).flatMap((entry) => objectsIn(entry)),
      ]
    : [];
}

const SMUGGLED_KEYS = [
  "riotId",
  "summonerName",
  "puuid",
  "wardScore",
  "respawnTimer",
  "summonerSpellCooldowns",
  "position",
  "skinName",
] as const;

const CASES = 400;

/**
 * Run `check` on `CASES` generated contexts, each under every initiation and
 * every flag state.
 */
function everyCase(
  seed: number,
  check: (input: {
    readonly raw: Record<string, unknown>;
    readonly initiation: CoachTurnInitiation;
    readonly flags: CoachPolicyFlags;
    readonly label: string;
  }) => void,
  prepare: (raw: Record<string, unknown>, next: () => number) => string = () =>
    "",
): void {
  const next = random(seed);
  for (let index = 0; index < CASES; index += 1) {
    const raw = generatedContext(next);
    const label = `case ${index.toString()} ${prepare(raw, next)}`;
    for (const initiation of INITIATIONS) {
      for (const flags of FLAG_STATES) {
        check({ raw, initiation, flags, label: `${label} ${initiation}` });
      }
    }
  }
}

/** The projection of an accepted context, or a thrown failure naming it. */
function projected(
  raw: Record<string, unknown>,
  initiation: CoachTurnInitiation,
  flags: CoachPolicyFlags,
  label: string,
) {
  const result = projectGameContext(raw, { initiation, flags });
  if (!result.ok) throw new Error(`${label} was refused`);
  return result.projection;
}

describe("projectGameContext", () => {
  test("no flag or initiation lets live state through on a turn the player did not start", () => {
    everyCase(0x5c_0a_7c, ({ raw, initiation, flags, label }) => {
      const projection = projected(raw, initiation, flags, label);
      const liveThrough =
        projection.context?.live !== undefined ||
        projection.accepted.includes("live");
      const allowed =
        PLAYER_INITIATIONS.has(initiation) &&
        flags.coachEnabled &&
        flags.liveAnswersEnabled &&
        "live" in raw;
      expect(liveThrough, label).toBe(allowed);
    });
  });

  test("only player_typed is player-initiated", () => {
    expect([...PLAYER_INITIATIONS]).toEqual(["player_typed"]);
    expect(INITIATIONS).toContain("app_initiated");
  });

  test("every other section passes exactly when the coach is on, whoever started the turn", () => {
    everyCase(0xc_0a_c4, ({ raw, initiation, flags, label }) => {
      const { present, accepted, withheld, context } = projected(
        raw,
        initiation,
        flags,
        label,
      );
      expect(present, label).toEqual(
        COACH_CONTEXT_SECTIONS.filter((section) => section in raw),
      );
      for (const section of present.filter((name) => name !== "live")) {
        expect(accepted.includes(section), label).toBe(flags.coachEnabled);
      }
      // Accepted and withheld split what was sent, and only accepted
      // sections reach the agent, unchanged.
      expect(
        [...accepted, ...withheld.map((entry) => entry.section)].toSorted(),
        label,
      ).toEqual([...present].toSorted());
      expect(Object.keys(context ?? {}).toSorted(), label).toEqual(
        [...accepted].toSorted(),
      );
      for (const section of accepted) {
        expect(context?.[section], label).toEqual(raw[section]);
      }
    });
  });

  test("a smuggled key anywhere refuses the whole context under every flag and initiation", () => {
    everyCase(
      0x7a_11_57,
      ({ raw, initiation, flags, label }) => {
        expect(projectGameContext(raw, { initiation, flags }).ok, label).toBe(
          false,
        );
      },
      (raw, next) => {
        const objects = objectsIn(raw);
        const target = objects[Math.floor(next() * objects.length)];
        const key = SMUGGLED_KEYS[Math.floor(next() * SMUGGLED_KEYS.length)];
        if (target === undefined || key === undefined) {
          throw new Error("the generator produced nothing to change");
        }
        target[key] = "x";
        return key;
      },
    );
  });

  test.each(fixtures.invalid)("refuses $reason", ({ body }) => {
    const result = projectGameContext(body, {
      initiation: "player_typed",
      flags: { coachEnabled: true, liveAnswersEnabled: true },
    });
    expect(result.ok).toBe(false);
  });

  test("names where a refused context broke the contract", () => {
    const result = projectGameContext(
      { postgame: { matchId: "NA1_1", win: true } },
      {
        initiation: "player_typed",
        flags: { coachEnabled: true, liveAnswersEnabled: true },
      },
    );
    expect(result).toEqual({ ok: false, issues: ["postgame"] });
  });

  test.each<[CoachTurnInitiation, CoachPolicyFlags, string | null]>([
    ["player_typed", { coachEnabled: true, liveAnswersEnabled: true }, null],
    [
      "player_typed",
      { coachEnabled: true, liveAnswersEnabled: false },
      "live_answers_disabled",
    ],
    [
      "player_typed",
      { coachEnabled: false, liveAnswersEnabled: true },
      "coach_disabled",
    ],
    [
      "app_initiated",
      { coachEnabled: true, liveAnswersEnabled: true },
      "not_player_initiated",
    ],
  ])(
    "live on a %s turn with %o is withheld for %s",
    (initiation, flags, reason) => {
      const result = projectGameContext(
        { live: complete["live"] },
        { initiation, flags },
      );
      if (!result.ok) throw new Error("the complete live section was refused");
      expect(result.projection.withheld).toEqual(
        reason === null ? [] : [{ section: "live", reason }],
      );
      expect(result.projection.context).toEqual(
        reason === null ? { live: complete["live"] } : null,
      );
    },
  );
});
