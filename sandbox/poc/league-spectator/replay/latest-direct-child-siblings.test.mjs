import { expect, test } from "bun:test";
import path from "node:path";
import {
  createLatestDirectChildSiblingPrograms,
  directChildFreeSiblingEligible,
  isLatestDirectChildSiblingPrograms,
  isLatestDirectChildSiblingProgram,
  canonicalChildSource,
} from "./latest-direct-child-siblings.mjs";
const cache = path.resolve(import.meta.dir, "../../../../.cache/replay-spike");
const profile = await Bun.file(
  path.join(cache, "public/decoder-16.21-macos/profile.json"),
).json();
const bytes = new Uint8Array(
  await Bun.file(
    path.join(cache, "public/latest-child-sibling-capabilities/package.json"),
  ).arrayBuffer(),
);
const manifest = await Bun.file(
  path.join(cache, "public/latest-effects/manifest.json"),
).json();
const factory = await createLatestDirectChildSiblingPrograms({
  profile,
  packageBytes: bytes,
});
async function source(id) {
  return (
    await Bun.file(
      path.join(cache, "public/latest-effects", manifest.definitions[id].file),
    ).json()
  ).definition;
}
async function compile(id, definition) {
  return factory.compile({
    id,
    definition,
    systemIdentity: {
      authored: true,
      objectPathHash: Number.parseInt(id.slice(-8), 16),
    },
  });
}

test("actual installed sources retain omitted key/index/ancestry and only existing quad siblings qualify", async () => {
  expect(isLatestDirectChildSiblingPrograms(factory)).toBe(true);
  expect(isLatestDirectChildSiblingPrograms({ ...factory })).toBe(false);
  for (const [id, childIndex, siblings] of [
    ["champions/akshan/20/14ad5334", 14, [17, 19]],
    ["champions/jinx/2/3b1dfaaf", 0, [2, 3, 4]],
  ]) {
    const definition = await source(id),
      program = await compile(id, definition);
    expect(isLatestDirectChildSiblingProgram(program)).toBe(true);
    expect(program.children.map((child) => child.emitterIndex)).toEqual([
      childIndex,
    ]);
    expect(program.children[0].ancestry.parentObjectPathHash).toBe(
      Number.parseInt(id.slice(-8), 16),
    );
    expect(program.children[0].requests[0].effectKey).toBe(
      Number.parseInt(
        definition.complexEmitterDefinitionData[
          childIndex
        ].childParticleSetDefinition.childrenIdentifiers[0].effectKey.slice(
          1,
          -1,
        ),
        16,
      ),
    );
    expect(program.childSchedulerActivationRecovered).toBe(false);
    expect(program.nativeParentCompletionRecovered).toBe(false);
    expect(
      Object.isFrozen(program.children[0].declaration.childrenIdentifiers),
    ).toBe(true);
    for (const index of siblings)
      expect(
        directChildFreeSiblingEligible(
          definition.complexEmitterDefinitionData[index],
          program,
        ),
      ).toBe(true);
    expect(
      directChildFreeSiblingEligible(
        definition.complexEmitterDefinitionData[childIndex],
        program,
      ),
    ).toBe(false);
    expect(
      directChildFreeSiblingEligible(
        { primitive: { __type: "VfxPrimitiveRay" } },
        program,
      ),
    ).toBe(false);
    expect(
      directChildFreeSiblingEligible(
        definition.complexEmitterDefinitionData[siblings[0]],
        structuredClone(program),
      ),
    ).toBe(false);
  }
});
test("content-addressed source support has no definition-ID branch and rejects changed child behavior", async () => {
  const id = "champions/akshan/20/14ad5334",
    definition = await source(id);
  const relocated = structuredClone(definition);
  relocated.objectPath = "{12345678}";
  expect(await compile("other/12345678", relocated)).not.toBeNull();
  for (const mutate of [
    (value) => {
      value.complexEmitterDefinitionData[14].rate.constantValue += 1;
    },
    (value) => {
      value.complexEmitterDefinitionData[14].childParticleSetDefinition.childrenIdentifiers[0].effectKey =
        "{12345678}";
    },
    (value) => {
      value.complexEmitterDefinitionData[14].childParticleSetDefinition.childrenIdentifiers.push(
        { __type: "VfxChildIdentifier", effectKey: "{12345678}" },
      );
    },
    (value) => {
      value.complexEmitterDefinitionData[14].childParticleSetDefinition.chanceOfCreation = 1;
    },
    (value) => {
      value.complexEmitterDefinitionData[14].childParticleSetDefinition = null;
    },
    (value) => {
      value.simpleEmitterDefinitionData = [{ childParticleSetDefinition: {} }];
    },
    (value) => {
      value.complexEmitterDefinitionData[17].nested = {
        childParticleSetDefinition: {},
      };
    },
    (value) => {
      value.objectPath = "{00000000}";
    },
  ]) {
    const changed = structuredClone(definition);
    mutate(changed);
    expect(await compile(id, changed)).toBeNull();
  }
});
test("package corruption/build mismatch and non-data source vectors fail closed", async () => {
  const changed = bytes.slice();
  changed[changed.length - 2] ^= 1;
  expect(
    createLatestDirectChildSiblingPrograms({ profile, packageBytes: changed }),
  ).rejects.toThrow();
  expect(
    createLatestDirectChildSiblingPrograms({
      profile: { ...profile, clientVersion: "other" },
      packageBytes: bytes,
    }),
  ).rejects.toThrow();
  expect(() => canonicalChildSource([, 1])).toThrow();
  expect(() => canonicalChildSource({ x: NaN })).toThrow();
  expect(canonicalChildSource({ b: 1, a: 2 })).toBe(
    canonicalChildSource({ a: 2, b: 1 }),
  );
});
