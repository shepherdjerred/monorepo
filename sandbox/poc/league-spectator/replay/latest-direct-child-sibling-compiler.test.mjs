import { expect, test } from "bun:test";
import path from "node:path";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { createDirectEffectKernels } from "./latest-direct-effect-worker.mjs";
import {
  createLatestDirectChildSiblingPrograms,
  isLatestDirectChildSiblingProgram,
} from "./latest-direct-child-siblings.mjs";
import { sha256 } from "./structural-comparison.mjs";
const assets = path.resolve(".cache/replay-spike/public");
const profile = await Bun.file(
  `${assets}/decoder-16.21-macos/profile.json`,
).json();
const manifestBytes = await Bun.file(
  `${assets}/latest-effects/manifest.json`,
).bytes();
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const kernels = await createDirectEffectKernels({
  profile,
  packages: Object.fromEntries(
    await Promise.all(
      ["values", "birth", "emission", "samplers"].map(async (name) => [
        name,
        await Bun.file(
          `${assets}/decoder-16.21-macos/vfx-${name}.json`,
        ).bytes(),
      ]),
    ),
  ),
});
const childSiblingPrograms = await createLatestDirectChildSiblingPrograms({
  profile,
  packageBytes: await Bun.file(
    `${assets}/latest-child-sibling-capabilities/package.json`,
  ).bytes(),
});
async function compile(id, capability = undefined, mutate = null) {
  let definitionBytes = await Bun.file(
    `${assets}/latest-effects/${manifest.definitions[id].file}`,
  ).bytes();
  let metadata = manifest,
    content = manifestBytes;
  if (mutate) {
    const source = JSON.parse(new TextDecoder().decode(definitionBytes));
    mutate(source.definition);
    definitionBytes = new TextEncoder().encode(JSON.stringify(source));
    metadata = structuredClone(manifest);
    metadata.definitions[id].sha256 = await sha256(definitionBytes);
    content = new TextEncoder().encode(JSON.stringify(metadata));
  }
  return compileLatestDirectEffect({
    id,
    definitionBytes,
    manifest: metadata,
    manifestBytes: content,
    kernels,
    ...(capability === undefined ? {} : { childSiblingPrograms: capability }),
  });
}
test("actual installed child roots retain all common component omissions and need owned source capability", async () => {
  for (const [id, indices, child] of [
    ["champions/akshan/20/14ad5334", [17, 19], 14],
    ["champions/jinx/2/3b1dfaaf", [2, 3, 4], 0],
  ]) {
    const before = await compile(id),
      after = await compile(id, childSiblingPrograms);
    expect(before.blockers).toContain("system:child-resource-ancestry");
    expect(before.childSiblingProgram).toBeNull();
    expect(after.blockers).not.toContain("system:child-resource-ancestry");
    expect(after.childResourceAncestryRequired).toBe(true);
    expect(isLatestDirectChildSiblingProgram(after.childSiblingProgram)).toBe(
      true,
    );
    expect(after.emitters.map((emitter) => emitter.index)).toEqual(indices);
    expect(after.emitters.map((emitter) => emitter.index)).toEqual(
      before.emitters.map((emitter) => emitter.index),
    );
    expect(
      after.unsupported.find((emitter) => emitter.index === child).reasons,
    ).toContain(
      "child:source-emitter-simulation-and-request-clock-untranslated",
    );
    expect(after.systemOmissions).toContain(
      "child:global-scheduler-activation-and-rendering-untranslated",
    );
    expect(after.childSiblingProgram.children[0].emitterIndex).toBe(child);
    expect(
      after.childSiblingProgram.children[0].ancestry.parentObjectPathHash,
    ).toBe(after.systemIdentity.objectPathHash);
    for (const emitter of after.emitters)
      expect(emitter.source.childParticleSetDefinition).toBeUndefined();
    for (const original of before.unsupported) {
      const current = after.unsupported.find(
        (emitter) => emitter.index === original.index,
      );
      for (const reason of original.reasons)
        expect(current.reasons).toContain(reason);
    }
  }
});
test("lookalike capability/mutated child sources cannot remove the ancestry gate", async () => {
  const id = "champions/akshan/20/14ad5334";
  await expect(compile(id, { ...childSiblingPrograms })).rejects.toThrow(
    "Owned child sibling",
  );
  await expect(compile(id, null)).rejects.toThrow("Owned child sibling");
  for (const mutate of [
    (definition) => {
      definition.complexEmitterDefinitionData[14].childParticleSetDefinition.childrenIdentifiers[0].effectKey =
        "{ffffffff}";
    },
    (definition) => {
      definition.complexEmitterDefinitionData[14].rate.constantValue += 1;
    },
    (definition) => {
      definition.complexEmitterDefinitionData[17].childParticleSetDefinition =
        null;
    },
  ]) {
    const result = await compile(id, childSiblingPrograms, mutate);
    expect(result.childSiblingProgram).toBeNull();
    expect(result.blockers).toContain("system:child-resource-ancestry");
  }
});
test("child capability neither waives other root/particle gates nor expands sibling primitive family", async () => {
  const id = "champions/akshan/20/14ad5334";
  const root = await compile(id, childSiblingPrograms, (definition) => {
    definition.unimplementedRootControl = true;
  });
  expect(root.childSiblingProgram).not.toBeNull();
  expect(root.blockers).toContain("system:unimplementedRootControl");
  const sibling = await compile(id, childSiblingPrograms, (definition) => {
    definition.complexEmitterDefinitionData[17].worldAcceleration = {
      __type: "IntegratedValueVector3",
    };
  });
  expect(sibling.childSiblingProgram).not.toBeNull();
  expect(sibling.emitters.map((emitter) => emitter.index)).toEqual([19]);
  expect(
    sibling.unsupported.find((emitter) => emitter.index === 17).reasons,
  ).toContain("field:worldAcceleration");
  const primitive = await compile(id, childSiblingPrograms, (definition) => {
    definition.complexEmitterDefinitionData[17].primitive = {
      __type: "VfxPrimitiveCameraTrail",
    };
  });
  expect(
    primitive.unsupported.find((emitter) => emitter.index === 17).reasons,
  ).toContain("child:sibling-primitive-not-native-proven");
});
