import { test, expect } from "bun:test";
import {
  createLatestRootAttachmentProviderKernels,
  ROOT_ATTACHMENT_PROVIDER_PROOF,
} from "./latest-root-attachment-provider.mjs";

const profile = {
  clientVersion: ROOT_ATTACHMENT_PROVIDER_PROOF.build,
  protocolDigest: ROOT_ATTACHMENT_PROVIDER_PROOF.protocol,
  decoderImageSha256: ROOT_ATTACHMENT_PROVIDER_PROOF.decoderImageSha256,
};
const kernels = createLatestRootAttachmentProviderKernels(profile);

test("root leaf preserves exact float32 copy, signed zero and caller ownership", () => {
  const source = [1 / 3, -0, 16777217];
  const result = kernels.copyRootPosition(0, source);
  expect(result).toEqual([Math.fround(1 / 3), -0, 16777216]);
  expect(Object.is(result[1], -0)).toBe(true);
  result[0] = 99;
  expect(source[0]).toBe(1 / 3);
  expect(kernels.copyRootPosition(0, source)[0]).toBe(Math.fround(1 / 3));
});

test("matrix skipping does not suppress independent wrapper flags", () => {
  const inherited = kernels.mapWrapperFlags(1, 0x80004000);
  expect(inherited).toBe(0x80004010);
  expect(kernels.requiresSourceMatrix(inherited)).toBe(true);
  expect(
    kernels.requiresSourceMatrix(kernels.mapWrapperFlags(5, 0x80004000)),
  ).toBe(false);
  expect(kernels.mapWrapperFlags(31, 0x80004000)).toBe(0x80004332);
  expect(kernels.proof.concreteHeroRootPositionEstablished).toBe(false);
  expect(kernels.proof.matchAttachmentsResolved).toBe(false);
});

test("unknown build, nonzero keys and invalid required inputs fail closed", () => {
  expect(() =>
    createLatestRootAttachmentProviderKernels({
      ...profile,
      clientVersion: "other",
    }),
  ).toThrow();
  expect(() =>
    createLatestRootAttachmentProviderKernels({
      ...profile,
      decoderImageSha256: "other",
    }),
  ).toThrow();
  expect(() => kernels.copyRootPosition(1, [0, 0, 0])).toThrow(
    "not translated",
  );
  for (const p of [null, [0, 0], [0, 0, NaN], [0, 0, Infinity], [0, 0, 1e39]])
    expect(() => kernels.copyRootPosition(0, p)).toThrow();
  for (const flag of [-1, 2 ** 32, 0.5, NaN, undefined]) {
    expect(() => kernels.mapWrapperFlags(flag, 0)).toThrow();
    expect(() => kernels.mapWrapperFlags(0, flag)).toThrow();
    expect(() => kernels.requiresSourceMatrix(flag)).toThrow();
  }
});

test("native Hero root selection requires observed proxy and override state", () => {
  const root = {
    proxyLookup: { status: "absent" },
    overrideFirstBits: 0x7f7fffff,
    overridePosition: null,
    basePosition: [11, 12, 13],
  };
  expect(kernels.selectHeroRootPosition(root)).toEqual({
    resolved: true,
    position: [11, 12, 13],
    source: "base-position",
    reasons: [],
  });
  expect(
    kernels.selectHeroRootPosition({
      ...root,
      proxyLookup: { status: "unknown" },
    }).resolved,
  ).toBe(false);
  expect(
    kernels.selectHeroRootPosition({
      ...root,
      proxyLookup: { status: "resolved", position: [9, 9, 9] },
    }).resolved,
  ).toBe(false);
  expect(
    kernels.selectHeroRootPosition({ ...root, overrideFirstBits: null })
      .reasons,
  ).toEqual(["world:hero-root-override-state-unresolved"]);
  expect(
    kernels.selectHeroRootPosition({ ...root, basePosition: null }).resolved,
  ).toBe(false);
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, 17.25, true);
  const overridden = {
    ...root,
    overrideFirstBits: view.getUint32(0, true),
    overridePosition: [17.25, 28.5, -39.75],
  };
  expect(kernels.selectHeroRootPosition(overridden).position).toEqual(
    overridden.overridePosition,
  );
  expect(() =>
    kernels.selectHeroRootPosition({
      ...overridden,
      overridePosition: [99, 0, 0],
    }),
  ).toThrow("disagrees");
});

test("native provider keeps missing animation component and owner identity causal", () => {
  const input = {
    entityId: 7,
    animationComponent: { status: "absent" },
    rootSelection: null,
  };
  expect(kernels.resolveRegisteredHeroRootPosition(input)).toEqual({
    resolved: false,
    reasons: ["world:hero-animation-component-absent"],
  });
  expect(
    kernels.resolveRegisteredHeroRootPosition({
      ...input,
      animationComponent: { status: "unknown" },
    }).resolved,
  ).toBe(false);
  expect(() =>
    kernels.resolveRegisteredHeroRootPosition({
      ...input,
      animationComponent: { status: "registered", ownerEntityId: 8 },
    }),
  ).toThrow("owner differs");
});
