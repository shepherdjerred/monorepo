import { expect, test } from "bun:test";
import { directChildSiblingResourceInputs } from "./latest-direct-child-sibling-resources.mjs";
const definitionId = "installed/12345678",
  program = { parentObjectPathHash: 0x12345678 };
function event() {
  const unit = (unitIndex, field, entityId, contextIdentity, handleId) => ({
    unitIndex,
    field,
    entityId,
    policy: "native-initial-resource-presentation-prefix-v1",
    actorKey: `actor/${contextIdentity}`,
    contextIdentity,
    resolverDefinitionId: contextIdentity + 1,
    browserStaticPackageReady: true,
    nativeAcceptance: null,
    nativeCacheReadiness: null,
    liveEngineResourceState: null,
    stack: {
      status: "supplied-resource-stack",
      base: { id: handleId, contextIdentity },
      overlays: [],
    },
  });
  return {
    descriptor: {
      field8c: 0,
      resourceKey: 123,
      resourceContextEntityId: 101,
      lookupA8EntityId: 102,
    },
    resourceSelection: {
      status: "matched-authored-reference",
      resourceKey: 123,
      resource: { status: "prepared-definition", effectId: definitionId },
      referenceToken: program.parentObjectPathHash,
      identity: 201,
      actorKey: "actor/201",
      handleId: "base/201",
      stage: { kind: "unit-base", unitIndex: 1 },
      presentation: {
        nativeAcceptance: null,
        nativeCacheReadiness: null,
        liveEngineResourceState: null,
        units: [
          unit(0, "resourceContextEntityId", 101, 200, "base/200"),
          unit(1, "lookupA8EntityId", 102, 201, "base/201"),
        ],
      },
    },
  };
}
test("selected base owner follows exact ordered descriptor roles, context and stable handle", () => {
  const input = event(),
    result = directChildSiblingResourceInputs(program, input, definitionId);
  expect(result.resolved).toBe(true);
  expect(result.evidence.field).toBe("lookupA8EntityId");
  expect(result.evidence.entityId).toBe(102);
  expect(result.evidence.handleId).toBe("base/201");
  expect(result.evidence.nativeResolverPointer).toBeNull();
  input.resourceSelection.presentation.units.reverse();
  expect(
    directChildSiblingResourceInputs(program, input, definitionId).resolved,
  ).toBe(true);
  const first = event();
  first.descriptor.resourceContextEntityId = 0;
  first.resourceSelection.stage.unitIndex = 0;
  first.resourceSelection.presentation.units = [
    { ...first.resourceSelection.presentation.units[1], unitIndex: 0 },
  ];
  expect(
    directChildSiblingResourceInputs(program, first, definitionId).resolved,
  ).toBe(true);
  expect(directChildSiblingResourceInputs(null, {}, definitionId)).toEqual({
    resolved: true,
    reasons: [],
    evidence: null,
  });
});
test("missing, foreign, ambiguous and non-base resource evidence cannot resolve child ancestry", () => {
  const mutations = [
    (value) => {
      delete value.resourceSelection;
    },
    (value) => {
      value.descriptor.field8c = 1;
    },
    (value) => {
      value.descriptor.resourceKey = 0;
    },
    (value) => {
      value.resourceSelection.resourceKey++;
    },
    (value) => {
      value.resourceSelection.resource.effectId = "foreign";
    },
    (value) => {
      value.resourceSelection.referenceToken++;
    },
    (value) => {
      value.resourceSelection.stage.kind = "unit-overlay";
    },
    (value) => {
      value.resourceSelection.stage.unitIndex = -1;
    },
    (value) => {
      value.resourceSelection.stage.unitIndex = 0;
    },
    (value) => {
      value.resourceSelection.identity++;
    },
    (value) => {
      value.resourceSelection.actorKey = "foreign";
    },
    (value) => {
      value.resourceSelection.handleId = "same-label-different-handle";
    },
    (value) => {
      value.resourceSelection.presentation.units[1].stack.base.id =
        "other-handle";
    },
    (value) => {
      value.resourceSelection.presentation.units[1].field =
        "resourceContextEntityId";
    },
    (value) => {
      value.resourceSelection.presentation.units[1].entityId = 101;
    },
    (value) => {
      value.resourceSelection.presentation.units[1].contextIdentity++;
    },
    (value) => {
      value.resourceSelection.presentation.units[1].resolverDefinitionId = 0;
    },
    (value) => {
      value.resourceSelection.presentation.units[1].stack.overlays = [null];
    },
    (value) => {
      value.resourceSelection.presentation.units[1].browserStaticPackageReady = false;
    },
    (value) => {
      value.resourceSelection.presentation.units[1].nativeAcceptance = true;
    },
    (value) => {
      value.resourceSelection.presentation.units[1].nativeCacheReadiness = true;
    },
    (value) => {
      value.resourceSelection.presentation.units[1].liveEngineResourceState = true;
    },
    (value) => {
      value.resourceSelection.presentation.nativeAcceptance = true;
    },
    (value) => {
      value.resourceSelection.presentation.nativeCacheReadiness = true;
    },
    (value) => {
      value.resourceSelection.presentation.liveEngineResourceState = true;
    },
    (value) => {
      delete value.resourceSelection.actorKey;
      delete value.resourceSelection.presentation.units[1].actorKey;
    },
    (value) => {
      value.resourceSelection.presentation.units.push(
        structuredClone(value.resourceSelection.presentation.units[1]),
      );
    },
  ];
  for (const mutate of mutations) {
    const input = event();
    mutate(input);
    const result = directChildSiblingResourceInputs(
      program,
      input,
      definitionId,
    );
    expect(result.resolved).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.evidence).toBeNull();
  }
});
test("contradictory duplicate owner handle across different contexts is rejected", () => {
  const input = event();
  input.resourceSelection.presentation.units[0].stack.base.id = "base/201";
  expect(
    directChildSiblingResourceInputs(program, input, definitionId).resolved,
  ).toBe(false);
});

test("the same unit in two original roles may retain one consistent base owner", () => {
  const input = event();
  input.descriptor.resourceContextEntityId = 102;
  input.resourceSelection.stage.unitIndex = 0;
  const selected = input.resourceSelection.presentation.units[1];
  input.resourceSelection.presentation.units[0] = {
    ...structuredClone(selected),
    unitIndex: 0,
    field: "resourceContextEntityId",
  };
  expect(
    directChildSiblingResourceInputs(program, input, definitionId).resolved,
  ).toBe(true);
});
