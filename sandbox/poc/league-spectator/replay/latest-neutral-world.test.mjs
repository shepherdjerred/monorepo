import { describe, expect, test } from "bun:test";
import { bindLatestNeutralMinions } from "./latest-neutral-world.mjs";
import { NEUTRAL_CREATION_PACKAGE_SHA } from "./latest-neutral-creation.mjs";

function control() {
  const build = "16.21.829.8620",
    protocol = "20e09df23c66b85e";
  const request = {
    kind: "neutral-creation-candidate",
    entityId: 1073742513,
    character: "SRU_Red",
    requestedSkinId: 3,
    nativeTeamEnum: 3,
    firstVectorArgument: [7765.244140625, 50.382999420166016, 4020.18701171875],
    time: 53.37075424194336,
    stream: 1,
    transportSequence: 14023,
    entryOrder: 0,
    nativeWorldAcceptance: false,
  };
  return {
    report: {
      build,
      protocol,
      endTime: 120,
      heroes: [],
      worldEvents: [],
      neutralCreationPackageSha256: NEUTRAL_CREATION_PACKAGE_SHA,
      neutralCreations: [request],
      neutralSnapshots: [
        { ...request, time: 60, stream: 2, transportSequence: 15000 },
      ],
    },
    manifest: { build, protocol, map: { id: 11, recordedMapSkin: "Default" } },
    catalog: {
      build,
      protocol,
      mapId: 11,
      assets: {
        "neutral/sru_red/3": {
          character: "SRU_Red",
          skinId: 3,
          scale: 1,
          characterRecords: ["Characters/SRU_Red/CharacterRecords/Root"],
        },
      },
      neutralCreation: {
        schema: 1,
        kind: "original-default-map11-neutral-candidates",
        argumentProgramSha256: NEUTRAL_CREATION_PACKAGE_SHA,
        nativeClass: "AIMinionClient",
        nativeVtableRva: 0x23013b8,
        positionArgument: "firstVectorArgument",
        resourceSkinPolicy: "original-empty-meta-default-map",
        resourceSkinProofSha256: "1".repeat(64),
        placementProofSha256: "2".repeat(64),
        scope: { nativeFactoryAccepted: false, snapshotsCreateEntities: false },
        bindings: {
          "sru_red/3": {
            character: "SRU_Red",
            requestedSkinId: 3,
            resourceSkinId: 3,
            asset: "neutral/sru_red/3",
            characterRecords: ["Characters/SRU_Red/CharacterRecords/Root"],
          },
        },
      },
    },
  };
}

const bind = ({ report, manifest, catalog }) =>
  bindLatestNeutralMinions(report, manifest, catalog);

describe("original Map11 neutral candidate binding", () => {
  test("one gameplay identity remains one entity across a later snapshot", () => {
    const input = control(),
      before = structuredClone(input),
      result = bind(input);
    expect(result.minions).toHaveLength(1);
    expect(result.get(1073742513)).toBe(result.minions[0]);
    expect(result.get(0)).toBeNull();
    expect(result.minions[0].creationPosition).toEqual(
      input.report.neutralCreations[0].firstVectorArgument,
    );
    expect(result.minions[0].event.team).toBeNull();
    expect(result.minions[0].event.resourceSkinId).toBe(3);
    expect(result.scope.nativeFactoryAccepted).toBe(false);
    expect(input).toEqual(before);
  });

  test("logical identity never aliases a hero, building or other gameplay creation", () => {
    for (const kind of [
      "hero",
      "building-identity-candidate",
      "lane-minion-creation-candidate",
      "npc-creation-candidate",
      "neutral",
    ]) {
      const input = control(),
        request = input.report.neutralCreations[0];
      if (kind === "hero")
        input.report.heroes.push({ entityId: request.entityId });
      else if (kind === "neutral")
        input.report.neutralCreations.push({
          ...request,
          transportSequence: 14024,
        });
      else input.report.worldEvents.push({ entityId: request.entityId, kind });
      expect(() => bind(input)).toThrow(
        "repeated original neutral gameplay identity",
      );
    }
  });

  test("a physical skin0 resource cannot satisfy requested native skin3", () => {
    const input = control();
    input.catalog.neutralCreation.bindings["sru_red/3"].resourceSkinId = 0;
    input.catalog.assets["neutral/sru_red/3"].skinId = 0;
    expect(() => bind(input)).toThrow(
      "Unprepared original neutral character/resource skin",
    );
  });

  test("snapshot rows, other MapSkins and corrupt placement are rejected", () => {
    const snapshot = control();
    snapshot.report.neutralCreations[0].stream = 2;
    expect(() => bind(snapshot)).toThrow("neutral gameplay identity");
    const variant = control();
    variant.manifest.map.recordedMapSkin = "Infernal";
    expect(() => bind(variant)).toThrow("Exact Default Map11");
    const position = control();
    position.report.neutralCreations[0].firstVectorArgument[1] = Infinity;
    expect(() => bind(position)).toThrow("neutral gameplay identity");
  });
});
