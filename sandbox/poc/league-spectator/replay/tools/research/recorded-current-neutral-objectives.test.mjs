import assert from "node:assert/strict";
import test from "node:test";
import {
  position944SubstitutionIndex,
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";
import {
  prepareCurrentNeutralObjectiveScene,
  readCurrentNeutralObjectiveModelIds,
} from "./recorded-current-neutral-objective-scene.mjs";
import { createCurrentNeutralObjectiveCollector } from "./recorded-current-neutral-objectives.mjs";

function replayWithFooter(baronKills = "0", hordeKills = "0") {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    DRAGON_KILLS: "0",
    ELDER_DRAGON_KILLS: "0",
    BARON_KILLS: index === 0 ? baronKills : "0",
    RIFT_HERALD_KILLS: "0",
    HORDE_KILLS: index === 0 ? hordeKills : "0",
  }));
  const footer = new TextEncoder().encode(
    JSON.stringify({ statsJson: JSON.stringify(rows) }),
  );
  const bytes = new Uint8Array(271 + footer.length + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x52494f54);
  view.setUint16(4, 2, true);
  bytes.set(footer, 271);
  view.setUint32(bytes.length - 4, footer.length, true);
  return {
    build: "16.23.841.8428",
    protocol: "8bbfcd5af2bc92db",
    bytes,
    duration: 10,
  };
}

const codecs = {
  decodePositionByte: (byte) =>
    (position944SubstitutionIndex(byte) + 0x67) & 0xff,
};
const binding = {
  verified: Array.from({ length: 10 }, (_, index) => ({
    context: 101 + index,
    footerRow: index + 1,
  })),
};
function creation(name) {
  const encode = (byte) => swapAdjacentBits(rotateByteLeft(byte ^ 0xa6, 7));
  const body = new Uint8Array(27 + name.length);
  body[26] = encode(name.length);
  body.set(
    Uint8Array.from(new TextEncoder().encode(name).reverse(), encode),
    27,
  );
  return body;
}
function packet(opcode, timeSeconds, payload = new Uint8Array()) {
  return {
    stream: 1,
    blockOffset: 0,
    marker: 0,
    explicitOpcode: opcode,
    paramBits: 120,
    timeSeconds,
    secondTimeBits: 0,
    payload,
  };
}

test("keeps a live Baron with an exact bounded position and allows timeline-only output", () => {
  const collector = createCurrentNeutralObjectiveCollector({
    replay: replayWithFooter(),
    binding,
    codecs,
    readWaypoints: () => ({
      syncId: 1,
      records: [{ entityId: 120, encodedWaypoints: [[2, -2]], speed: 0 }],
    }),
  });
  collector.observe(packet(392, 1, creation("SRU_Baron")));
  collector.observe(packet(96, 3));
  const evidence = collector.finish();
  assert.equal(evidence.actors[0].objectName, "SRU_Baron");
  assert.equal(evidence.actors[0].killTimeSeconds, null);
  const project = (models) =>
    prepareCurrentNeutralObjectiveScene({
      evidence,
      modelIds: readCurrentNeutralObjectiveModelIds(models),
      waypointOrigin: [7358, 7412],
      durationSeconds: 10,
    });
  assert.deepEqual(project([["sru_baron", 203]]).neutralObjectiveInstances, [
    {
      context: 120,
      participantId: 203,
      creationTimeSeconds: 1,
      killTimeSeconds: null,
      paths: [
        {
          timeSeconds: 3,
          endTimeSeconds: 3,
          points: [[7362, 7408]],
          speeds: [{ timeSeconds: 3, speed: 0, distance: 0 }],
        },
      ],
    },
  ]);
  assert.deepEqual(project([]).neutralObjectiveOmissions, {
    missingAuthoredModel: 1,
  });
});

test("keeps ordinary camp observations separate and counts unsupported variants", () => {
  const observed = [];
  const collector = createCurrentNeutralObjectiveCollector({
    replay: replayWithFooter(),
    includeCamps: true,
    binding,
    codecs,
    readWaypoints: () => ({
      syncId: 1,
      records: [{ entityId: 120, encodedWaypoints: [[1, 2]], speed: 0 }],
    }),
    onCampBirth: (...row) => observed.push(row),
    onBirth: () => assert.fail("Camp cannot enter the pit objective stream"),
  });
  collector.observe(packet(392, 1, creation("SRU_Red.8.1")));
  collector.observe({
    ...packet(392, 1, creation("SRU_Red.8.2")),
    paramBits: 121,
  });
  collector.observe(packet(96, 3));
  const evidence = collector.finish();
  assert.deepEqual(evidence.actors, []);
  assert.deepEqual(evidence.events, []);
  assert.deepEqual(observed, [[120, 1]]);
  assert.equal(evidence.campActors[0].modelId, "sru_red");
  assert.equal(evidence.campActors[0].killTimeSeconds, null);
  assert.equal(evidence.campActors[0].observations.length, 1);
  assert.deepEqual(evidence.campCoverage, {
    births: 2,
    closed: 0,
    open: 1,
    omissions: {
      unsupportedCampNames: 1,
      incompleteLifecycle: 0,
      missingRecordedMotion: 0,
    },
  });
});

test("omits ordinary camps with ambiguous endpoints and rejects malformed packets", () => {
  const make = (name) => {
    const collector = createCurrentNeutralObjectiveCollector({
      replay: replayWithFooter(),
      includeCamps: true,
      binding,
      codecs,
    });
    collector.observe(packet(392, 1, creation(name)));
    return collector;
  };
  const terminal = (time) => packet(1197, time, Uint8Array.of(0x63, 0));
  const camp = make("SRU_Red.8.1");
  camp.observe(terminal(2));
  camp.observe(terminal(3));
  const evidence = camp.finish();
  assert.deepEqual(evidence.campActors, []);
  assert.equal(evidence.campCoverage.omissions.incompleteLifecycle, 1);

  const horde = make("SRU_Horde.12.1");
  horde.observe(terminal(2));
  assert.throws(() => horde.observe(terminal(3)), /Repeated current objective/);
  assert.throws(
    () => make("SRU_Red.8.1").observe(packet(1197, 2)),
    /Truncated lane death header/,
  );
});

test("rejects mismatched footer, unrelated build, malformed name and model binding", () => {
  const options = { replay: replayWithFooter("1"), binding, codecs };
  assert.throws(
    () => createCurrentNeutralObjectiveCollector(options).finish(),
    /differ from the replay footer/,
  );
  assert.throws(
    () =>
      createCurrentNeutralObjectiveCollector({
        ...options,
        includeCamps: true,
        replay: replayWithFooter("0", "1"),
      }).finish(),
    /Horde credits differ/,
  );
  assert.throws(
    () =>
      createCurrentNeutralObjectiveCollector({
        ...options,
        replay: { ...options.replay, build: "16.23.840.6595" },
      }),
    /exact \.8428/,
  );
  assert.throws(
    () =>
      createCurrentNeutralObjectiveCollector(options).observe(packet(392, 2)),
    /name framing/,
  );
  assert.throws(
    () =>
      readCurrentNeutralObjectiveModelIds([
        ["sru_baron", 1],
        ["sru_riftherald", 1],
      ]),
    /model binding/,
  );
});
