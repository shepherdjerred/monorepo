import { expect, test } from "bun:test";
import { createLatestReplayState } from "./latest-replay-state.mjs";
import { NEUTRAL_CREATION_PACKAGE_SHA } from "./latest-neutral-creation.mjs";
import { MAP11_CORPUS_CHARACTER_RECORDS_PROOF_SHA } from "./latest-map11-neutral-contract.mjs";

function fixture() {
  const report = {
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    endTime: 10,
    heroes: [],
    lifecycle: [],
    casts: [],
    playerIdentities: [],
    championStateUpdates: [],
    neutralCreationPackageSha256: NEUTRAL_CREATION_PACKAGE_SHA,
    neutralCreations: [
      {
        kind: "neutral-creation-candidate",
        entityId: 17,
        time: 2,
        stream: 1,
        nativeWorldAcceptance: false,
        nativeTeamEnum: 2,
        firstVectorArgument: [4, 5, 6],
      },
    ],
  };
  const world = {
    entities: [
      {
        entityId: 17,
        entityClass: "neutral-minion",
        creationTime: 2,
        team: null,
        nativeTeamEnum: 2,
        creationPosition: [4, 5, 6],
      },
    ],
    updates: [
      {
        entityId: 17,
        time: 3,
        transportSequence: 5,
        recordIndex: 0,
        currentHealth: 100,
        maxHealth: 200,
      },
    ],
    neutralCreation: {
      argumentProgramSha256: NEUTRAL_CREATION_PACKAGE_SHA,
      characterRecordsProofSha256:
        "a027c6d4e6d5e8bd6258212f956e0bbfe577e5f350f860ee2abc6a0207f2201e",
      nativeFactoryAccepted: false,
      snapshotsCreateEntities: false,
    },
  };
  return { report, world };
}
test("native-bound neutral state stays absent before creation and has no invented team/stat before observations", () => {
  const { report, world } = fixture(),
    state = createLatestReplayState(report, world);
  expect(state.sampleEntity(17, 1).present).toBe(false);
  expect(state.sampleEntity(17, 2).currentHealth).toBe(null);
  expect(state.sampleEntity(17, 4).currentHealth).toBe(100);
  expect(state.sampleEntity(17, 4).team).toBe(null);
  expect(state.sampleEntity(17, 2).currentHealth).toBe(null);
});
test("the independent two-replay neutral record proof retains absolute forward/back state semantics", () => {
  const { report, world } = fixture();
  world.neutralCreation.characterRecordsProofSha256 =
    MAP11_CORPUS_CHARACTER_RECORDS_PROOF_SHA;
  const state = createLatestReplayState(report, world);
  expect(state.sampleEntity(17, 4).currentHealth).toBe(100);
  expect(state.sampleEntity(17, 1).present).toBe(false);
  expect(state.sampleEntity(17, 2).currentHealth).toBe(null);
});
test("neutral state requires the exact original gameplay request and scoped native record proof", () => {
  for (const mutate of [
    ({ world }) => {
      delete world.neutralCreation;
    },
    ({ world }) => {
      world.neutralCreation.nativeFactoryAccepted = true;
    },
    ({ world }) => {
      world.neutralCreation.characterRecordsProofSha256 = "a".repeat(64);
    },
    ({ world }) => {
      world.entities[0].creationPosition[0] = 9;
    },
    ({ report }) => {
      report.neutralCreations[0].stream = 2;
    },
    ({ world }) => {
      world.entities[0].team = 100;
    },
  ]) {
    const value = fixture();
    mutate(value);
    expect(() => createLatestReplayState(value.report, value.world)).toThrow();
  }
});
test("legacy lane state retains its existing input contract", () => {
  const { report, world } = fixture();
  delete world.neutralCreation;
  world.entities = [
    { entityId: 17, entityClass: "lane-minion", creationTime: 2, team: null },
  ];
  expect(
    createLatestReplayState(report, world).sampleEntity(17, 4).currentHealth,
  ).toBe(100);
});
