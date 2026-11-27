import { describe, expect, test } from "vitest";
import { buildAbilityMechanics } from "./ability-mechanics.ts";
import { cleanNumber } from "./ability-facts.ts";
import type { CDragonSpellRecord } from "./update-data-dragon-schemas.ts";

const missile = (
  width: number,
  movement: Record<string, unknown>,
  behaviors: string[],
) => ({
  mMissileSpec: {
    mMissileWidth: width,
    movementComponent: movement,
    behaviors: behaviors.map((name) => ({ __type: name })),
  },
});

/** The shape of Ahri's Q and E in the CommunityDragon bin. */
const SPELLS = new Map<string, CDragonSpellRecord>([
  [
    "characters/ahri/spells/ahriqability/ahriq",
    {
      mCastTime: 0.25,
      castRadius: [275, 275],
      missileSpeed: 1100,
      mLineWidth: 100,
      mTargetingTypeData: { __type: "Location" },
    },
  ],
  [
    "characters/ahri/spells/ahriqability/ahriqmissile",
    missile(
      100,
      {
        __type: "AcceleratingMovement",
        mInitialSpeed: 2500,
        mMinSpeed: 400,
        mMaxSpeed: 2500,
      },
      ["CastOnHit", "DestroyOnMovementComplete"],
    ),
  ],
  [
    "characters/ahri/spells/ahrieability/ahrie",
    { mTargetingTypeData: { __type: "Direction" }, mLineWidth: 60 },
  ],
  [
    "characters/ahri/spells/ahrieability/ahriemissile",
    missile(60, { __type: "FixedSpeedMovement", mSpeed: 1550.0000001 }, [
      "CastOnHit",
      "DestroyOnMovementComplete",
      "DestroyOnHit",
    ]),
  ],
  ["characters/ahri/spells/ahribasicattack", {}],
]);

describe("buildAbilityMechanics", () => {
  test("reads the aiming data and the missiles under the same ability", () => {
    expect(
      buildAbilityMechanics(
        SPELLS,
        "characters/ahri/spells/ahriqability/ahriq",
        cleanNumber,
      ),
    ).toEqual({
      targeting: "Location",
      castTime: 0.25,
      radius: 275,
      lineWidth: 100,
      missileSpeed: 1100,
      missiles: [
        {
          name: "ahriqmissile",
          width: 100,
          movement: "AcceleratingMovement",
          speed: 2500,
          minSpeed: 400,
          maxSpeed: 2500,
          tracksTarget: false,
          behaviors: ["CastOnHit", "DestroyOnMovementComplete"],
          stopsOnFirstHit: false,
        },
      ],
    });
  });

  test("a missile with DestroyOnHit ends at the first unit it hits, and float noise is cleaned", () => {
    const charm = buildAbilityMechanics(
      SPELLS,
      "characters/ahri/spells/ahrieability/ahrie",
      cleanNumber,
    );
    expect(charm?.targeting).toBe("Direction");
    expect(charm?.missiles).toHaveLength(1);
    expect(charm?.missiles[0]).toMatchObject({
      stopsOnFirstHit: true,
      speed: 1550,
      width: 60,
    });
  });

  test("states nothing for a spell the bin says nothing about, and never borrows another ability's missiles", () => {
    expect(
      buildAbilityMechanics(
        SPELLS,
        "characters/ahri/spells/ahribasicattack",
        cleanNumber,
      ),
    ).toBeUndefined();
    expect(
      buildAbilityMechanics(
        SPELLS,
        "characters/ahri/spells/missing",
        cleanNumber,
      ),
    ).toBeUndefined();
  });
});
