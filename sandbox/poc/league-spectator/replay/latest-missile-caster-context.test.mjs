import { expect, test } from "bun:test";
import {
  collectNamedBoneTypeOneCasterRecords,
  createOwnedMissileCasterStarts,
} from "./latest-missile-caster-context.mjs";

test("Map11 cannot reach the legacy rig path without its explicit scene authority", async () => {
  const build = "16.21.829.8620",
    protocol = "20e09df23c66b85e",
    imageHash = "a".repeat(64),
    reads = [];
  await expect(
    createOwnedMissileCasterStarts({
      report: { build, protocol, decoderImageSha256: imageHash },
      scene: { map: { id: 11 } },
      profile: {
        clientVersion: build,
        protocolDigest: protocol,
        decoderImageSha256: imageHash,
      },
      world: {
        viewerRoot() {
          throw Error("No world pose may be supplied to an unbound rig");
        },
      },
      records: [],
      load: async (file) => {
        reads.push(file);
        throw Error("Unbound legacy resource read");
      },
    }),
  ).rejects.toThrow(
    "Selected Map11 caster requires explicit scene animation authority",
  );
  expect(reads).toEqual([]);
});

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
