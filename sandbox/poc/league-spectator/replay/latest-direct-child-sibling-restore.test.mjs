import { expect, test } from "bun:test";
import path from "node:path";
import { restoreLatestDirectChildSiblingPrograms } from "./latest-direct-child-sibling-restore.mjs";
import {
  createLatestDirectChildSiblingPrograms,
  isLatestDirectChildSiblingProgram,
} from "./latest-direct-child-siblings.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { createDirectEffectKernels } from "./latest-direct-effect-worker.mjs";
import { LatestDirectEffectRuntime } from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";
const assets = path.resolve(".cache/replay-spike/public");
const profile = await Bun.file(
  `${assets}/decoder-16.21-macos/profile.json`,
).json();
const effectsManifest = await Bun.file(
  `${assets}/latest-effects/manifest.json`,
).bytes();
const manifest = JSON.parse(new TextDecoder().decode(effectsManifest));
const childSiblings = await Bun.file(
  `${assets}/latest-child-sibling-capabilities/package.json`,
).bytes();
const factory = await createLatestDirectChildSiblingPrograms({
  profile,
  packageBytes: childSiblings,
});
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
const ids = ["champions/akshan/20/14ad5334", "champions/jinx/2/3b1dfaaf"];
const definitions = new Map(),
  childSiblingDefinitions = [];
for (const id of ids) {
  const bytes = await Bun.file(
    `${assets}/latest-effects/${manifest.definitions[id].file}`,
  ).bytes();
  childSiblingDefinitions.push([id, bytes]);
  definitions.set(
    id,
    await compileLatestDirectEffect({
      id,
      definitionBytes: bytes,
      manifest,
      manifestBytes: effectsManifest,
      kernels,
      childSiblingPrograms: factory,
    }),
  );
}
const contentHash = await sha256(effectsManifest);
const fresh = () =>
  structuredClone({
    packages: { effectsManifest, childSiblings, childSiblingDefinitions },
    definitions,
  });
const restore = (value) =>
  restoreLatestDirectChildSiblingPrograms({ ...value, profile, contentHash });
test("both installed roots regain owned programs from exact static bytes after worker clone", async () => {
  const value = fresh();
  for (const d of value.definitions.values())
    expect(isLatestDirectChildSiblingProgram(d.childSiblingProgram)).toBe(
      false,
    );
  await restore(value);
  for (const id of ids) {
    const d = value.definitions.get(id);
    expect(isLatestDirectChildSiblingProgram(d.childSiblingProgram)).toBe(true);
    expect(d.childSiblingProgram).toEqual(
      definitions.get(id).childSiblingProgram,
    );
    expect(Object.isFrozen(d.childSiblingProgram.children[0])).toBe(true);
  }
});
test("source inventory, stale bytes and forged serialized child programs fail closed", async () => {
  const mutations = [
    (value) => {
      delete value.packages.effectsManifest;
    },
    (value) => {
      value.packages.effectsManifest[0] ^= 1;
    },
    (value) => {
      delete value.packages.childSiblings;
    },
    (value) => {
      value.packages.childSiblings[0] ^= 1;
    },
    (value) => {
      delete value.packages.childSiblingDefinitions;
    },
    (value) => {
      value.packages.childSiblingDefinitions.pop();
    },
    (value) => {
      value.packages.childSiblingDefinitions.push(
        value.packages.childSiblingDefinitions[0],
      );
    },
    (value) => {
      value.packages.childSiblingDefinitions[0][0] = "foreign";
    },
    (value) => {
      value.packages.childSiblingDefinitions[0][1][0] ^= 1;
    },
    (value) => {
      value.definitions.get(ids[0]).definitionHash = "0".repeat(64);
    },
    (value) => {
      value.definitions.get(ids[0]).systemIdentity.objectPathHash++;
    },
    (value) => {
      value.definitions.get(ids[0]).childSiblingProgram.parentObjectPathHash++;
    },
    (value) => {
      value.definitions.get(ids[0]).childSiblingProgram.children[0].requests[0]
        .effectKey++;
    },
    (value) => {
      value.definitions.get(
        ids[0],
      ).childSiblingProgram.children[0].emitterIndex = 17;
    },
    (value) => {
      value.definitions.get(
        ids[0],
      ).childSiblingProgram.children[0].childEmitterSourceSha256 = "0".repeat(
        64,
      );
    },
    (value) => {
      value.definitions.get(ids[0]).childSiblingProgram.nativeAcceptance = true;
    },
    (value) => {
      value.definitions.get(
        ids[0],
      ).childSiblingProgram.childSchedulerActivationRecovered = true;
    },
    (value) => {
      value.definitions.get(ids[0]).childSiblingProgram.omissions = [];
    },
  ];
  for (const mutate of mutations) {
    const value = fresh();
    mutate(value);
    await expect(restore(value)).rejects.toThrow();
  }
});

test("stripping every serialized program cannot bypass retained original-source inventory", async () => {
  for (const required of [true, false]) {
    const value = fresh();
    for (const definition of value.definitions.values()) {
      definition.childSiblingProgram = null;
      definition.childResourceAncestryRequired = required;
    }
    await expect(restore(value)).rejects.toThrow("source inventory");
  }
});

test("runtime ownership checks reject a false ancestry flag and non-quad sibling after restoration", async () => {
  const construct = (value) =>
    new LatestDirectEffectRuntime({
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      contentHash,
      replayHash: "a".repeat(64),
      definitions: value.definitions,
      events: [],
      kernels,
      world: {
        placement: () => {
          throw new Error("No world query expected at construction");
        },
      },
    });
  const valid = fresh();
  await restore(valid);
  expect(() => construct(valid)).not.toThrow();
  const flag = fresh();
  flag.definitions.get(ids[0]).childResourceAncestryRequired = false;
  await restore(flag);
  expect(() => construct(flag)).toThrow(
    "Owned compiled child sibling capability",
  );
  const primitive = fresh();
  primitive.definitions.get(ids[0]).emitters[0].source.primitive = {
    __type: "VfxPrimitiveMesh",
  };
  await restore(primitive);
  expect(() => construct(primitive)).toThrow(
    "Unadmitted child-bearing or primitive sibling",
  );
});
