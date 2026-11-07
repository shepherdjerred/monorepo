import { expect, test } from "bun:test";
import { collectNamedBoneTypeOneCasterRecords } from "./latest-missile-caster-context.mjs";

test("named type1 source routing owns an inclusive requested prefix and preserves original record identity", () => {
  const make = (time) => ({
    time,
    cast: {
      ownerId: 3,
      sourceName: "Caster",
      spellHash: 7,
      targetCount: 1,
      overrideFlag14d: 0,
      forceRecordedSourcePosition: false,
    },
  });
  const first = make(1),
    boundary = make(2),
    future = make(3),
    report = { endTime: 99, missiles: [first, boundary, future] },
    subjects = [
      {
        entityId: 3,
        character: "Caster",
        catalog: {
          spells: {
            7: {
              data: {
                mCastType: 1,
                mMissileSpec: {
                  movementComponent: {
                    __type: "FixedSpeedMovement",
                    mStartBoneName: "WEAPON",
                  },
                },
              },
            },
          },
        },
      },
    ];
  let settingsQueries = 0;
  const initialization = {
    settings() {
      settingsQueries++;
      return { particleStartOffset: [0, 0, 0] };
    },
  };
  const result = collectNamedBoneTypeOneCasterRecords({
    report,
    subjects,
    initialization,
    endTime: 2,
  });
  expect(result).toEqual([first, boundary]);
  expect(result[0]).toBe(first);
  expect(result[1]).toBe(boundary);
  expect(settingsQueries).toBe(2);
  future.cast = null;
  expect(
    collectNamedBoneTypeOneCasterRecords({
      report,
      subjects,
      initialization,
      endTime: 2,
    }),
  ).toEqual(result);
  expect(() =>
    collectNamedBoneTypeOneCasterRecords({
      report,
      subjects,
      initialization,
      endTime: NaN,
    }),
  ).toThrow("routing time");
  first.cast.sourceName = "Other";
  expect(
    collectNamedBoneTypeOneCasterRecords({
      report,
      subjects,
      initialization,
      endTime: 2,
    }),
  ).toEqual([boundary]);
});
