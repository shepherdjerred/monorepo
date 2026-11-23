import { expect, test } from "bun:test";
import { validateOrdinalModelLayout } from "./ordinal-model-layout.mjs";
const hash = "a".repeat(64);
function fixture() {
  const sourceJoints = [
      { rigId: 0, parentId: -1, name: "root" },
      { rigId: 1, parentId: 0, name: "same" },
      { rigId: 2, parentId: 0, name: "other" },
      { rigId: 3, parentId: 2, name: "same" },
    ],
    sourcePalette = [3, 1],
    joints = sourceJoints.map((joint, index) => ({
      poseJointIndex: index,
      rigId: joint.rigId,
      parentRigId: joint.parentId,
      originalName: joint.name,
      nodeIndex: index + 1,
      nodeName: `scout_joint_${index}`,
    }));
  return {
    sourceJoints,
    sourcePalette,
    bindings: {
      schema: 1,
      kind: "original-rig-ordinal-model-bindings",
      joints,
      palette: sourcePalette.map((id, index) => ({
        paletteIndex: index,
        rigId: id,
        poseJointIndex: id,
        nodeIndex: id + 1,
      })),
      vertexSkinning: {
        weightBitDifferences: 0,
        sourceWeightedJointIdsSha256: hash,
        exportedWeightedJointIdsSha256: hash,
      },
    },
    gltf: {
      nodes: [
        { mesh: 0, skin: 0, children: [1] },
        { name: "scout_joint_0", children: [2, 3] },
        { name: "scout_joint_1" },
        { name: "scout_joint_2", children: [4] },
        { name: "scout_joint_3" },
      ],
      skins: [{ joints: [4, 2], inverseBindMatrices: 0 }],
      accessors: [{ count: 2 }],
    },
  };
}
test("both repeated source names retain distinct ordinal parents and exact source palette", () => {
  const result = validateOrdinalModelLayout(fixture());
  expect(result.jointNodeIndices).toEqual([1, 2, 3, 4]);
  expect(result.paletteJointOrdinals).toEqual([3, 1]);
});
test("changed or missing original vertex weight proof rejects", () => {
  for (const differences of [1, -1, null, undefined]) {
    const value = fixture();
    value.bindings.vertexSkinning.weightBitDifferences = differences;
    expect(() => validateOrdinalModelLayout(value)).toThrow("weighted vertex");
  }
});
test("name collapse, changed parent or swapped vertex palette reject", () => {
  for (const mutate of [
    (value) => (value.bindings.joints[3].nodeIndex = 2),
    (value) => value.gltf.nodes[1].children.push(4),
    (value) => value.gltf.skins[0].joints.reverse(),
    (value) =>
      (value.bindings.vertexSkinning.exportedWeightedJointIdsSha256 =
        "b".repeat(64)),
  ]) {
    const value = fixture();
    mutate(value);
    expect(() => validateOrdinalModelLayout(value)).toThrow();
  }
});
