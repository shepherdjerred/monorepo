import { expect, test } from "bun:test";
import {
  createLatestWorldPresentation,
  EFFECT_ENTITY_FIELDS,
} from "./latest-world-presentation.mjs";

const build = "16.21.829.8620",
  protocol = "20e09df23c66b85e";
const scene = {
  build,
  protocol,
  map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
};
const terrain = { sampleHeight: () => ({ inside: true, height: 4 }) };
const cursor = (transportSequence, entryOrder = 0, exclusive = false) => ({
  transportSequence,
  entryOrder,
  exclusive,
});
const npc = {
  kind: "npc-creation-candidate",
  entityId: 10,
  character: "RecordedNpc",
  skinId: 2,
  skinStatus: "candidate; asset validation required",
  creationPosition: [0, 0, 0],
  time: 1,
  transportSequence: 10,
  entryOrder: 1,
};
const building = {
  kind: "building-identity-candidate",
  entityId: 20,
  mapNameHash: 123,
  team: 100,
  time: 1,
  transportSequence: 10,
  entryOrder: 2,
};
const minion = {
  kind: "lane-minion-creation-candidate",
  entityId: 30,
  barracksId: 20,
  unitType: 4,
  time: 1,
  transportSequence: 10,
  entryOrder: 3,
};
const report = {
  build,
  protocol,
  heroes: [],
  worldEvents: [npc, building, minion],
  movement: [],
  lifecycle: [],
  casts: [],
  attacks: [],
  missiles: [],
};
const create = (overrides = {}, inputs = {}) =>
  createLatestWorldPresentation({
    report: { ...report, ...overrides },
    scene,
    terrain,
    ...inputs,
  });
test("internal reference snapshots reuse exact causal samples while public views remain independently mutable", () => {
  const internal = [],
    world = create(
      {},
      {
        resourceTracks: [
          {
            entityId: 10,
            time: 2,
            transportSequence: 20,
            entryOrder: 0,
            stack: { base: { id: "a" }, overlays: [] },
          },
          {
            entityId: 10,
            time: 2,
            transportSequence: 20,
            entryOrder: 1,
            stack: { base: { id: "b" }, overlays: [] },
          },
        ],
        placementResolver: ({ references }) => {
          internal.push(references);
          return {
            resolved: true,
            position: [...references[0].entity.position],
            reasons: [],
          };
        },
      },
    ),
    descriptor = Object.fromEntries(
      EFFECT_ENTITY_FIELDS.map((field) => [field, 10]),
    ),
    event = { descriptor };
  world.placement(event, 2, cursor(20));
  world.placement(event, 2, cursor(20));
  expect(internal[0][0].entity).toBe(internal[1][0].entity);
  expect(internal[0][0].entity).toBe(internal[0][1].entity);
  expect(Object.isFrozen(internal[0][0].entity.resourceStack.base)).toBe(true);
  const entity = world.entity(10, 2, cursor(20)),
    references = world.references(descriptor, 2, cursor(20));
  entity.position[0] = 999;
  entity.resourceStack.base.id = "changed";
  references[0].entity.resourceStack.base.id = "alsochanged";
  expect(world.entity(10, 2, cursor(20)).resourceStack.base.id).toBe("a");
  expect(world.entity(10, 2, cursor(20)).position[0]).toBe(0);
  expect(world.entity(10, 2, cursor(20, 1)).resourceStack.base.id).toBe("b");
  expect(world.entity(10, 2, cursor(20, 1, true)).resourceStack.base.id).toBe(
    "a",
  );
  expect(world.entity(10, 2, cursor(20)).resourceStack.base.id).toBe("a");
  expect(world.entity(10, 1, cursor(10, 0))).toBeNull();
  expect(world.entity(10, 2, cursor(20)).resourceStack.base.id).toBe("a");
});

test("resource and attachment tracks reject ambiguous causal ownership before sampling", () => {
  const observation = {
    entityId: 10,
    time: 2,
    transportSequence: 20,
    entryOrder: 0,
    stack: { status: "supplied-resource-stack", base: null, overlays: [] },
  };
  const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1];
  const pose = { ...observation, key: 0, transform, validUntil: 3 };
  for (const [field, row] of [
    ["resourceTracks", observation],
    ["attachmentTracks", pose],
  ]) {
    for (const invalid of [
      { transportSequence: -1 },
      { entryOrder: "0" },
      { entryOrder: 0.5 },
    ])
      expect(() => create({}, { [field]: [{ ...row, ...invalid }] })).toThrow(
        "entity/clock",
      );
    for (const values of [
      [row, { ...row }],
      [{ ...row, entryOrder: undefined }, row],
    ])
      expect(() => create({}, { [field]: values })).toThrow("Duplicate causal");
  }
  const older = {
      ...observation,
      stack: { ...observation.stack, base: "older" },
    },
    newer = {
      ...older,
      entryOrder: 1,
      stack: { ...older.stack, base: "newer" },
    };
  const world = create(
    {},
    {
      resourceTracks: [newer, older],
      attachmentTracks: [pose, { ...pose, key: 1 }],
    },
  );
  expect(world.entity(10, 2, cursor(20, 0)).resourceStack.base).toBe("older");
  expect(world.entity(10, 2, cursor(20, 1)).resourceStack.base).toBe("newer");
  expect(world.entity(10, 2, cursor(20, 0)).resourceStack.base).toBe("older");
  expect(world.attachment(10, 1, 2, cursor(20)).resolved).toBe(true);
});

test("attachment validity cannot become unbounded through invalid interval metadata", () => {
  const pose = {
    entityId: 10,
    time: 2,
    transportSequence: 20,
    key: 0,
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1],
  };
  for (const invalid of [
    { validUntil: NaN },
    { validUntil: Infinity },
    { validUntil: 1 },
    { key: -1 },
    { key: 0x100000000 },
  ])
    expect(() =>
      create({}, { attachmentTracks: [{ ...pose, ...invalid }] }),
    ).toThrow("attachment transform");
  const world = create({}, { attachmentTracks: [pose] });
  expect(world.attachment(10, 0, 2, cursor(20)).resolved).toBe(true);
  expect(world.attachment(10, 0, 2.1).resolved).toBe(false);
});

test("decoded NPC, building and minion identities retain causal creation without inventing positions or resource contexts", () => {
  const world = create();
  expect(world.entity(10, 1, cursor(10, 0))).toBeNull();
  expect(world.entity(10, 1, cursor(10, 1, true))).toBeNull();
  expect(world.entity(10, 1, cursor(10, 1))).toMatchObject({
    entityClass: "npc",
    character: "RecordedNpc",
    skinId: 2,
    appearanceStatus: npc.skinStatus,
    position: [0, 0, 0],
    positionStatus: "recorded-creation-position",
    resourceStack: null,
  });
  expect(world.entity(20, 1, cursor(10, 1))).toBeNull();
  expect(world.entity(20, 1, cursor(10, 2))).toMatchObject({
    entityClass: "building",
    mapNameHash: 123,
    position: null,
    positionStatus: "unknown",
    resourceStack: null,
    reasons: ["world:missing-entity-position:20"],
  });
  expect(world.entity(30, 1, cursor(10, 3))).toMatchObject({
    entityClass: "lane-minion",
    barracksId: 20,
    unitType: 4,
    position: null,
    positionStatus: "unknown",
    appearanceStatus: "unresolved-map-barracks-binding",
    resourceStack: null,
    visibility: "unknown",
    lifecycle: "alive",
  });
  const descriptor = Object.fromEntries(
    EFFECT_ENTITY_FIELDS.map((field, index) => [field, [20, 30, 10, 0][index]]),
  );
  expect(
    world
      .references(descriptor, 1, cursor(10, 2))
      .map((reference) => reference.status),
  ).toEqual(["registered", "inactive", "registered", "native-null"]);
  expect(
    world
      .references(descriptor, 1, cursor(10, 3))
      .map((reference) => reference.status),
  ).toEqual(["registered", "registered", "registered", "native-null"]);
  expect(world.attachment(20, 0, 1, cursor(10, 3))).toMatchObject({
    resolved: false,
    reasons: ["world:missing-attachment:20:0"],
  });
  expect(world.entity(30, 0.5)).toBeNull();
});

test("a recorded movement update resolves an unknown minion position and backward sampling restores the unknown state", () => {
  const motion = (sequence, transportSequence, coordinate) => ({
    entityId: 30,
    time: 2,
    sequence,
    transportSequence,
    syncId: sequence,
    speed: 0,
    encodedWaypoints: [[coordinate, coordinate]],
  });
  const world = create({
    movement: [motion(1, 20, 1), motion(3, 22, 2)],
    lifecycle: [
      {
        kind: "death-candidate",
        entityId: 30,
        time: 2,
        sequence: 2,
        transportSequence: 21,
      },
    ],
  });
  expect(world.entity(30, 2, cursor(19)).position).toBeNull();
  expect(world.entity(30, 2, cursor(20))).toMatchObject({
    position: [7, 4, 7],
    positionStatus: "movement-derived-preview",
    lifecycle: "alive",
  });
  expect(world.entity(30, 2, cursor(22))).toMatchObject({
    position: [7, 4, 7],
    lifecycle: "dead",
  });
  expect(world.entity(30, 2).position).toEqual([7, 4, 7]);
  expect(world.entity(30, 3).position).toEqual([7, 4, 7]);
  expect(world.entity(30, 1, cursor(10, 3))).toMatchObject({
    position: null,
    positionStatus: "unknown",
    lifecycle: "alive",
  });
  expect(world.entity(30, 2, cursor(20)).position).toEqual([7, 4, 7]);
  const unorderedDeath = create({
    lifecycle: [
      { kind: "death-candidate", entityId: 30, time: 2, sequence: 2 },
    ],
  });
  expect(() => unorderedDeath.entity(30, 2)).toThrow(
    "original packet ordinals",
  );
});

test("unknown or off-grid position does not erase a known resource observation or supply a bone pose", () => {
  const stack = { status: "supplied-resource-stack", base: null, overlays: [] };
  const resourceTracks = [
    { entityId: 30, time: 1, transportSequence: 11, stack },
  ];
  const world = create({}, { resourceTracks });
  expect(world.entity(30, 1, cursor(11))).toMatchObject({
    position: null,
    resourceStack: stack,
  });
  const outside = create(
    {
      movement: [
        {
          entityId: 30,
          time: 2,
          sequence: 1,
          transportSequence: 20,
          syncId: 1,
          speed: 0,
          encodedWaypoints: [[1, 1]],
        },
      ],
    },
    {
      resourceTracks,
      terrain: { sampleHeight: () => ({ inside: false }) },
    },
  );
  expect(outside.entity(30, 2, cursor(20))).toMatchObject({
    position: null,
    positionStatus: "unknown",
    resourceStack: stack,
    lifecycle: "alive",
    reasons: ["world:terrain-outside-grid"],
  });
  expect(outside.attachment(30, 0, 2, cursor(20)).resolved).toBe(false);
});

test("world registry rejects duplicate identities, malformed creation fields and unknown decoded entity classes", () => {
  expect(() => create({ worldEvents: [npc, npc] })).toThrow("duplicate");
  expect(() => create({ worldEvents: [{ ...npc, entityId: 0 }] })).toThrow(
    "Invalid",
  );
  expect(() =>
    create({ worldEvents: [{ ...npc, creationPosition: null }] }),
  ).toThrow("NPC");
  expect(() => create({ worldEvents: [{ ...minion, barracksId: 0 }] })).toThrow(
    "lane-minion",
  );
  expect(() =>
    create({ worldEvents: [{ ...building, mapNameHash: -1 }] }),
  ).toThrow("building");
  expect(() =>
    create({ worldEvents: [{ ...npc, transportSequence: -1 }] }),
  ).toThrow("Invalid");
  expect(() =>
    create({ worldEvents: [{ ...npc, kind: "unknown-entity-class" }] }),
  ).toThrow("Unknown decoded");
  expect(() => create({ worldEvents: {} })).toThrow("array");
  expect(() =>
    create(
      {},
      {
        entities: [
          { entityId: 40, position: null, creationTime: 2, removalTime: 1 },
        ],
      },
    ),
  ).toThrow("Invalid");
  expect(() =>
    create(
      {},
      { entities: [{ entityId: 10, position: [1, 2, 3], creationTime: 0 }] },
    ),
  ).toThrow("duplicate");
});
