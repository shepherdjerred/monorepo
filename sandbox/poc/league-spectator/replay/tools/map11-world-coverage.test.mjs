import { expect, test } from "bun:test";
import { inspectMap11WorldCoverage } from "./map11-world-coverage.mjs";
function fixture() {
  return {
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    replaySha256: "a".repeat(64),
    duration: 1500,
    endTime: 120,
    startup: { configuredMapId: 11, mode: "CLASSIC" },
    heroes: [{ entityId: 1 }],
    worldEntities: [{ entityId: 2 }],
    worldEvents: [
      { kind: "building-identity-candidate", entityId: 2 },
      {
        kind: "npc-creation-candidate",
        entityId: 3,
        character: "Sru_Crab",
        skinId: 0,
        time: 1,
      },
      {
        kind: "npc-creation-candidate",
        entityId: 4,
        character: "ExactPet",
        skinId: 7,
        time: 2,
      },
      {
        kind: "npc-creation-candidate",
        entityId: 4,
        character: "ExactPet",
        skinId: 7,
        time: 3,
      },
    ],
    movement: [
      { entityId: 1 },
      { entityId: 2 },
      { entityId: 3 },
      { entityId: 4 },
      { entityId: 5 },
      { entityId: 5 },
    ],
  };
}
test("coverage keeps decoded skins separate from static assets, accepted entities and unknown spawn routes", () => {
  const out = inspectMap11WorldCoverage(fixture(), {
    assets: { "sru_crab/0": {} },
  });
  expect(out.decodedWholeWindow).toBe(false);
  expect(out.actorRequests).toEqual([
    {
      character: "ExactPet",
      skinId: 7,
      role: "world",
      characterRecords: ["Characters/ExactPet/CharacterRecords/Root"],
    },
  ]);
  expect(
    out.npcSkins.find((row) => row.key === "exactpet/7").creationRecords,
  ).toBe(2);
  expect(out.npcSkins.every((row) => row.acceptedWorldEntities === 0)).toBe(
    true,
  );
  expect(out.movementWithoutKnownCreation).toEqual([
    { entityId: 5, records: 2 },
  ]);
});
test("reuse stays explicit and whole duration requires the actual full window", () => {
  const report = fixture();
  report.endTime = 1500;
  report.worldEvents.push({
    kind: "npc-creation-candidate",
    entityId: 4,
    character: "OtherPet",
    skinId: 0,
    time: 10,
  });
  const out = inspectMap11WorldCoverage(report, { assets: {} });
  expect(out.decodedWholeWindow).toBe(true);
  expect(out.conflictingNpcIdentities).toEqual([
    { entityId: 4, identities: ["exactpet/7", "otherpet/0"] },
  ]);
});

test("decoded missiles are known identities without pretending to be NPC spawn coverage", () => {
  const report = fixture();
  report.missiles = [{ entityId: 5 }];
  const out = inspectMap11WorldCoverage(report, { assets: {} });
  expect(out.movementWithoutKnownCreation).toEqual([]);
  expect(out.npcSkins).toHaveLength(2);
});
test("unknown map, protocol and malformed original skins fail rather than default", () => {
  for (const mutate of [
    (r) => (r.startup.configuredMapId = 12),
    (r) => (r.protocol = "unknown"),
    (r) => (r.worldEvents[1].skinId = null),
    (r) => (r.worldEvents[1].character = ""),
  ]) {
    const r = fixture();
    mutate(r);
    expect(() => inspectMap11WorldCoverage(r, { assets: {} })).toThrow();
  }
});
