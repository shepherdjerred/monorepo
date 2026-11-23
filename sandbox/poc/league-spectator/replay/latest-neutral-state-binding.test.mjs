import { expect, test } from "bun:test";
import { bindLatestNeutralCorpseEntity } from "./latest-neutral-state-binding.mjs";
import { NEUTRAL_CREATION_PACKAGE_SHA } from "./latest-neutral-creation.mjs";
import {
  MAP11_NEUTRAL_CHARACTER_RECORDS_PROOF_SHA,
  MAP11_CORPUS_CHARACTER_RECORDS_PROOF_SHA,
} from "./latest-map11-neutral-contract.mjs";

function fixture() {
  return {
    report: {
      build: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      neutralCreationPackageSha256: NEUTRAL_CREATION_PACKAGE_SHA,
      worldEntities: [],
      neutralCreations: [
        {
          entityId: 17,
          kind: "neutral-creation-candidate",
          stream: 1,
          time: 10,
          transportSequence: 30,
          nativeWorldAcceptance: false,
        },
      ],
    },
    binding: {
      entityClass: "neutral-minion",
      event: { entityId: 17, time: 10, transportSequence: 30 },
    },
  };
}
test("neutral corpse candidate uses its original separate gameplay inventory without rewriting generic entities", () => {
  const { report, binding } = fixture();
  expect(
    bindLatestNeutralCorpseEntity(
      report,
      binding,
      MAP11_NEUTRAL_CHARACTER_RECORDS_PROOF_SHA,
    ),
  ).toEqual({ entityId: 17, entityClass: "neutral-minion", creationTime: 10 });
  expect(report.worldEntities).toEqual([]);
  expect(
    bindLatestNeutralCorpseEntity(
      report,
      binding,
      MAP11_CORPUS_CHARACTER_RECORDS_PROOF_SHA,
    ),
  ).toEqual({ entityId: 17, entityClass: "neutral-minion", creationTime: 10 });
});
test("snapshots, duplicate identities, unproven native records and changed source ordinals cannot bind corpse subjects", () => {
  for (const mutate of [
    (value) => {
      value.report.neutralCreations[0].stream = 2;
    },
    (value) => {
      value.report.neutralCreations.push({
        ...value.report.neutralCreations[0],
      });
    },
    (value) => {
      value.binding.event.transportSequence = 31;
    },
    (value) => {
      value.report.neutralCreations[0].nativeWorldAcceptance = true;
    },
    (value) => {
      value.report.neutralCreationPackageSha256 = "f".repeat(64);
    },
  ]) {
    const value = fixture();
    mutate(value);
    expect(() =>
      bindLatestNeutralCorpseEntity(
        value.report,
        value.binding,
        MAP11_NEUTRAL_CHARACTER_RECORDS_PROOF_SHA,
      ),
    ).toThrow();
  }
  const { report, binding } = fixture();
  expect(() =>
    bindLatestNeutralCorpseEntity(report, binding, "f".repeat(64)),
  ).toThrow();
});
