import { test, expect } from "bun:test";
import {
  deriveLatestViewerResourceBounds,
  sampleLatestViewerResourceBoundSize,
  resolveLatestViewerBoundSizePlacement,
  VIEWER_BOUND_SIZE_POLICY,
} from "./latest-viewer-bound-size.mjs";
import { directBoundFlexScale } from "./latest-direct-effect-flex.mjs";
const hex = (values) =>
  Buffer.from(new Float32Array(values).buffer).toString("hex");
test("original typed resource, moved-root cached bounds and current Flex scale agree byte-for-byte", async () => {
  const report = await Bun.file(
    ".cache/replay-lineup-5667809143/research/attached-bound-resource-native-v37.json",
  ).json();
  expect(report.scope.originalComponentSetterAndCurrentParticleScaleOrder).toBe(
    true,
  );
  for (const control of report.controls) {
    const skn = new Uint8Array(12 + 80 + 60 + 6 + 52 + 12),
      view = new DataView(skn.buffer),
      at = 92;
    view.setUint32(0, 0x112233, true);
    view.setUint16(4, 4, true);
    view.setUint16(6, 1, true);
    view.setUint32(8, 1, true);
    view.setUint32(at + 4, 3, true);
    view.setUint32(at + 8, 1, true);
    view.setUint32(at + 12, 52, true);
    control.meshBounds.forEach((x, i) =>
      view.setFloat32(at + 20 + i * 4, x, true),
    );
    const resource = deriveLatestViewerResourceBounds(skn, {
      __type: "SkinMeshDataProperties",
      ...(control.suppliedBox === null
        ? {}
        : { overrideBoundingBox: control.suppliedBox }),
      ...(control.suppliedRadius === null
        ? {}
        : { boundingSphereRadius: control.suppliedRadius }),
    });
    expect(hex(resource.resourceBounds)).toBe(control.resourceBoundsHex);
    expect(hex([resource.sphereRadius])).toBe(control.radiusHex);
  }
  for (const row of report.actors) {
    if (row.status) continue;
    for (const control of row.suppliedViewerBounds) {
      const result = sampleLatestViewerResourceBoundSize(
        {
          resolved: true,
          resourceBounds: row.resourceBounds,
          sphereRadius: row.radius,
          modelScale: control.modelScale,
        },
        control.root,
      );
      expect(hex(result.cachedAabb)).toBe(control.cachedAabbHex);
      expect(hex([result.boundObjectSize])).toBe(control.boundSizeHex);
    }
  }
  for (const row of report.flexControls) {
    const factor = directBoundFlexScale(
      {
        __type: "VfxFlexShapeDefinitionData",
        scaleBirthScaleByBoundObjectSize: Math.fround(0.005),
      },
      row.boundSize,
    );
    expect(Object.is(factor, row.factor)).toBe(true);
    expect(
      hex(
        row.birthScale.map((x, i) =>
          Math.fround(
            Math.fround(Math.fround(x) * Math.fround(row.sampledScale[i])) *
              factor,
          ),
        ),
      ),
    ).toBe(row.currentScaleHex);
  }
});
test("actual installed SKN and skin source derive exact native resource bounds", async () => {
  const root = ".cache/replay-lineup-5667809143/public/latest-scene",
    scene = await Bun.file(`${root}/manifest.json`).json(),
    report = await Bun.file(
      ".cache/replay-lineup-5667809143/research/attached-bound-resource-native-v37.json",
    ).json();
  for (const row of report.actors) {
    const asset = scene.champions[row.actorKey],
      skin = await Bun.file(`${root}/${asset.skinDefinition}`).json(),
      skn = await Bun.file(
        `${root}/${asset.model.replace(/[^/]+$/, "model.skn")}`,
      ).bytes(),
      props =
        skin[`Characters/${asset.champion}/Skins/Skin${asset.skinId}`]
          .skinMeshProperties,
      result = deriveLatestViewerResourceBounds(skn, props);
    if (row.status) {
      expect(result.resolved).toBe(false);
      continue;
    }
    expect(result.resolved).toBe(true);
    expect(hex(result.resourceBounds)).toBe(row.resourceBoundsHex);
    expect(hex([result.sphereRadius])).toBe(row.radiusHex);
    const corrupt = skn.slice();
    new DataView(corrupt.buffer).setFloat32(
      12 + new DataView(corrupt.buffer).getUint32(8, true) * 80 + 20,
      NaN,
      true,
    );
    expect(() => deriveLatestViewerResourceBounds(corrupt, props)).toThrow(
      "Invalid installed mesh bounds",
    );
    expect(() =>
      deriveLatestViewerResourceBounds(skn, {
        ...props,
        boundingSphereRadius: null,
      }),
    ).toThrow("Finite authored sphere");
  }
});
test("only exact attached owner obtains size and missing resource keeps placement partial", () => {
  const refs = [{ field: "attachmentEntityId", entityId: 17 }],
    placement = {
      resolved: true,
      position: [1, 2, 3],
      references: refs,
      reasons: ["world:attached-bound-object-size-unknown"],
    },
    event = { descriptor: { attachmentEntityId: 17 } },
    definition = {
      emitters: [
        { placementRequirements: { boundObjectSize: "finite-nonnegative" } },
      ],
    },
    cursor = { transportSequence: 5, entryOrder: 2 };
  let query;
  const input = {
    event,
    time: 72,
    cursor,
    world: {
      viewerBoundSize(...args) {
        query = args;
        return {
          resolved: true,
          policy: VIEWER_BOUND_SIZE_POLICY,
          entityId: 17,
          boundObjectSize: 300,
          omissions: ["bound-size:native-live-model-readiness-unestablished"],
        };
      },
    },
  };
  const result = resolveLatestViewerBoundSizePlacement(
    placement,
    input,
    definition,
  );
  expect(query).toEqual([17, 72, cursor]);
  expect(result.references).toBe(refs);
  expect(result.boundObjectSize).toBe(300);
  expect(result.reasons).not.toContain(
    "world:attached-bound-object-size-unknown",
  );
  input.world.viewerBoundSize = () => ({
    resolved: false,
    policy: VIEWER_BOUND_SIZE_POLICY,
    reasons: ["bound-size:unsupported-skn-version:2:1"],
  });
  const omitted = resolveLatestViewerBoundSizePlacement(
    placement,
    input,
    definition,
  );
  expect(omitted.resolved).toBe(true);
  expect(omitted.boundObjectSize).toBeUndefined();
  expect(omitted.reasons).toContain(
    "world:bound-size:unsupported-skn-version:2:1",
  );
  input.world.viewerBoundSize = () => ({
    resolved: true,
    policy: VIEWER_BOUND_SIZE_POLICY,
    entityId: 18,
    boundObjectSize: 300,
    omissions: [],
  });
  expect(() =>
    resolveLatestViewerBoundSizePlacement(placement, input, definition),
  ).toThrow("Exact attached bound owner");
});
