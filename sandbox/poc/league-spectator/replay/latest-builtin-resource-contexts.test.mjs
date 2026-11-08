import { expect, test } from "bun:test";
import { createLatestBuiltinResourceContexts } from "./latest-builtin-resource-contexts.mjs";
import { createLatestEffectContexts } from "./latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "./latest-effect-resolvers.mjs";
import { createLatestUnitResources } from "./latest-unit-resources.mjs";

const cache = new URL(
  "../../../../.cache/replay-spike/public/",
  import.meta.url,
);
const profile = await Bun.file(
  new URL("decoder-16.21-macos/profile.json", cache),
).json();
const packageBytes = await Bun.file(
  new URL("latest-builtin-resource-contexts/package.json", cache),
).bytes();

test("original Shared null getter does not admit cold-registry misses", async () => {
  const policy = await createLatestBuiltinResourceContexts({
    profile,
    packageBytes,
  });
  expect(policy.lookup(3579051965)).toEqual({
    status: "known-null-resource-resolver",
    identity: 3579051965,
    contextKind: "built-in-shared",
    originalGetterRva: 0x35a270,
  });
  for (const identity of [0, 1, 3143740604, 0xffffffff, 0x2820acf5])
    expect(policy.lookup(identity)).toBeNull();
  for (const identity of [-1, 1.5, NaN, "3579051965", 0x100000000])
    expect(() => policy.lookup(identity)).toThrow("Unsigned context identity");
  expect(Object.isFrozen(policy.lookup(3579051965))).toBe(true);
});

test("built-in resource programs reject incompatible builds and corrupt bytes", async () => {
  await expect(
    createLatestBuiltinResourceContexts({
      profile: { ...profile, clientVersion: "16.20" },
      packageBytes,
    }),
  ).rejects.toThrow("contract");
  await expect(
    createLatestBuiltinResourceContexts({
      profile: { ...profile, decoderImageSha256: "0".repeat(64) },
      packageBytes,
    }),
  ).rejects.toThrow("contract");
  const corrupt = packageBytes.slice();
  corrupt[0] ^= 1;
  await expect(
    createLatestBuiltinResourceContexts({ profile, packageBytes: corrupt }),
  ).rejects.toThrow("Pinned");
});

test("Shared null resolver preserves unit, unknown-context and alternate-name precedence", async () => {
  const load = (path) => Bun.file(new URL(path, cache)).bytes();
  const effectsManifestBytes = await load("latest-effects/manifest.json");
  const contexts = await createLatestEffectContexts({
    profile,
    effectsManifestBytes,
    packageBytes: await load("latest-effect-contexts/package.json"),
  });
  const resolvers = await createLatestEffectResolvers({
    profile,
    contexts,
    effectsManifestBytes,
    packageBytes: await load("latest-effect-resolvers/package.json"),
    builtinContextPackageBytes: packageBytes,
  });
  const policy = await createLatestUnitResources({
    profile,
    resolvers,
    packageBytes: await load("latest-unit-resources/package.json"),
  });
  expect(resolvers.lookup(3579051965, 0x32cee353)).toMatchObject({
    status: "key-absent",
    reason: "built-in-context-resource-getter-returned-null",
  });
  expect(resolvers.selectAuxiliary([3579051965], 0x32cee353).status).toBe(
    "continue-global-resolution",
  );
  expect(
    resolvers.selectAuxiliary([3579051965, 3143740604], 0x32cee353),
  ).toMatchObject({
    status: "unprepared-context-id",
    identity: 3143740604,
    index: 1,
  });
  expect(
    resolvers.selectAuxiliary([3143740604, 3579051965], 0x32cee353),
  ).toMatchObject({
    status: "unprepared-context-id",
    identity: 3143740604,
    index: 0,
  });
  expect(resolvers.selectAuxiliary([3579051965], 0).status).toBe(
    "alternate-name-unresolved",
  );
  expect(
    policy.selectSuppliedStacks(
      {
        units: [{ status: "unresolved-unit-resource-stack", entityId: 123 }],
        auxiliaries: [{ id: "shared", contextIdentity: 3579051965 }],
      },
      0x32cee353,
    ).status,
  ).toBe("unresolved-unit-resource-stack");
});
