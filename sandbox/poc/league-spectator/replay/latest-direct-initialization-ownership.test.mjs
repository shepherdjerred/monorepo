import { test, expect } from "bun:test";
import {
  copyDirectCompilationInitialization,
  copyDirectViewerPoseInitialization,
  createDirectInitializationTransfer,
  consumeDirectInitializationTransfer,
} from "./latest-direct-initialization-ownership.mjs";
import { directInitializationBufferStats } from "./latest-direct-compiled-restore.mjs";
import { LatestDirectEffectClient } from "./latest-direct-effect-client.mjs";
const digest = "a".repeat(64);
function pose() {
  return {
    schema: 1,
    policy: "test",
    contentHash: digest,
    hashes: { "pose/a.bin": digest },
    packages: { "pose/a.bin": new Uint8Array([4, 5, 6]) },
  };
}
function fixture() {
  const source = pose(),
    compilationSource = new Uint8Array([1, 2, 3, 4]),
    compilation = copyDirectCompilationInitialization([
      ["effects/a.json", compilationSource],
    ]),
    viewer = copyDirectViewerPoseInitialization(source),
    payload = {
      definitions: [],
      packages: {
        compilationInputs: compilation.value,
        viewerPoseAssets: viewer.value,
      },
    };
  return {
    source,
    compilationSource,
    payload,
    ticket: createDirectInitializationTransfer(payload, [
      compilation.ownership,
      viewer.ownership,
    ]),
  };
}
test("owned copies transfer exactly once while producer stores retain bytes", () => {
  const f = fixture(),
    expected = directInitializationBufferStats(f.payload),
    plan = consumeDirectInitializationTransfer(f.ticket, f.payload),
    received = structuredClone(f.payload, { transfer: plan.transfers });
  expect(plan.transferredBuffers).toBe(2);
  expect(plan.transferredBufferBytes).toBe(7);
  expect(directInitializationBufferStats(received)).toEqual(expected);
  expect(plan.transfers.map((b) => b.byteLength)).toEqual([0, 0]);
  expect([...f.compilationSource]).toEqual([1, 2, 3, 4]);
  expect([...f.source.packages["pose/a.bin"]]).toEqual([4, 5, 6]);
  expect(() =>
    consumeDirectInitializationTransfer(f.ticket, f.payload),
  ).toThrow();
});
test("selected native image copy is measured and catalog aliases add no transferred image span", () => {
  const source = pose(),
    path = "decoder-16.21-macos/image.bin";
  source.packages[path] = new Uint8Array([9, 8, 7, 6]);
  source.hashes[path] = digest;
  const viewer = copyDirectViewerPoseInitialization(source),
    compilation = copyDirectCompilationInitialization([
      ["effects/a.json", new Uint8Array([1])],
    ]),
    payload = {
      packages: {
        viewerPoseAssets: viewer.value,
        compilationInputs: compilation.value,
      },
      diagnosticAlias: { image: viewer.value.packages[path] },
    };
  const plan = consumeDirectInitializationTransfer(
    createDirectInitializationTransfer(payload, [
      compilation.ownership,
      viewer.ownership,
    ]),
    payload,
  );
  expect(viewer.initializationMetrics.nativeImage.bytes).toBe(4);
  expect(viewer.initializationMetrics.nativeImage.copies).toBe(1);
  expect(
    viewer.initializationMetrics.nativeImage.copyCpuMs,
  ).toBeGreaterThanOrEqual(0);
  expect(plan.transferredBuffers).toBe(3);
  expect(plan.transferredBufferBytes).toBe(8);
  expect(
    plan.scopes.find((s) => s.scope === "viewerPoseAssets").details.nativeImage
      .bytes,
  ).toBe(4);
  expect(directInitializationBufferStats(payload).uniqueBuffers).toBe(3);
});
test("compilation reuses only exact privately owned pose inputs and transfers their buffers once", () => {
  const source = pose(),
    path = "decoder-16.21-macos/image.bin";
  source.packages[path] = new Uint8Array(4096).fill(17);
  source.hashes[path] = digest;
  const viewer = copyDirectViewerPoseInitialization(source),
    compilation = copyDirectCompilationInitialization(
      [
        [path, source.packages[path]],
        ["effects/a.json", new Uint8Array([1, 2])],
        ["pose/a.bin", source.packages["pose/a.bin"]],
      ],
      { viewerPoseInitialization: viewer },
    ),
    payload = {
      packages: {
        viewerPoseAssets: viewer.value,
        compilationInputs: compilation.value,
      },
    };
  expect(compilation.value[0][1]).toBe(viewer.value.packages[path]);
  expect(compilation.value[2][1]).toBe(viewer.value.packages["pose/a.bin"]);
  const plan = consumeDirectInitializationTransfer(
      createDirectInitializationTransfer(payload, [
        compilation.ownership,
        viewer.ownership,
      ]),
      payload,
    ),
    received = structuredClone(payload, { transfer: plan.transfers });
  expect(plan.transferredBuffers).toBe(3);
  expect(plan.transferredBufferBytes).toBe(4101);
  expect(plan.scopes[0].details.borrowedStaticInputBytes).toBe(4099);
  expect(plan.scopes[0].details.sharedNativeImage).toBe(true);
  expect(received.packages.compilationInputs[0][1]).toBe(
    received.packages.viewerPoseAssets.packages[path],
  );
  expect(source.packages[path].byteLength).toBe(4096);
});
test("shared compiler inputs reject lookalike owners, unequal bytes and a substituted pose producer", () => {
  const viewer = copyDirectViewerPoseInitialization(pose()),
    entries = [["pose/a.bin", new Uint8Array([4, 5, 6])]];
  for (const candidate of [
    { value: viewer.value, ownership: {} },
    { value: { ...viewer.value }, ownership: viewer.ownership },
  ])
    expect(() =>
      copyDirectCompilationInitialization(entries, {
        viewerPoseInitialization: candidate,
      }),
    ).toThrow();
  expect(() =>
    copyDirectCompilationInitialization(
      [["pose/a.bin", new Uint8Array([4, 5, 7])]],
      { viewerPoseInitialization: viewer },
    ),
  ).toThrow("bytes differ");
  const compilation = copyDirectCompilationInitialization(entries, {
      viewerPoseInitialization: viewer,
    }),
    other = copyDirectViewerPoseInitialization(pose()),
    payload = {
      packages: {
        viewerPoseAssets: other.value,
        compilationInputs: compilation.value,
      },
    };
  expect(() =>
    createDirectInitializationTransfer(payload, [
      compilation.ownership,
      other.ownership,
    ]),
  ).toThrow("exact pose producer");
  payload.packages.viewerPoseAssets = viewer.value;
  const ticket = createDirectInitializationTransfer(payload, [
    compilation.ownership,
    viewer.ownership,
  ]);
  structuredClone(viewer.value.packages["pose/a.bin"], {
    transfer: [viewer.value.packages["pose/a.bin"].buffer],
  });
  expect(() => consumeDirectInitializationTransfer(ticket, payload)).toThrow(
    "detached",
  );
});
test("replacement consumes capability and cannot transfer an alternate payload", () => {
  for (const change of [
    (f) => ({ ...f.payload }),
    (f) => {
      f.payload.packages = { ...f.payload.packages };
      return f.payload;
    },
    (f) => {
      f.payload.packages.viewerPoseAssets = {
        ...f.payload.packages.viewerPoseAssets,
      };
      return f.payload;
    },
  ]) {
    const f = fixture();
    expect(() =>
      consumeDirectInitializationTransfer(f.ticket, change(f)),
    ).toThrow();
    expect(() =>
      consumeDirectInitializationTransfer(f.ticket, f.payload),
    ).toThrow();
  }
  const c = copyDirectCompilationInitialization([["a", new Uint8Array([1])]]),
    v = copyDirectViewerPoseInitialization(pose()),
    payload = {
      packages: { compilationInputs: c.value, viewerPoseAssets: v.value },
    };
  createDirectInitializationTransfer(payload, [c.ownership, v.ownership]);
  expect(() =>
    createDirectInitializationTransfer(payload, [c.ownership, v.ownership]),
  ).toThrow();
});
test("producer inventories reject incomplete, unbounded, aliased and non-own metadata", () => {
  for (const mutate of [
    (p) => delete p.packages["pose/a.bin"],
    (p) => (p.packages.extra = new Uint8Array([1])),
    (p) => (p.hashes.extra = digest),
    (p) => (p.hashes[Symbol("extra")] = digest),
    (p) => Object.setPrototypeOf(p.packages, {}),
  ]) {
    const p = pose();
    mutate(p);
    expect(() => copyDirectViewerPoseInitialization(p)).toThrow();
  }
  const bytes = new Uint8Array([1, 2]);
  for (const entries of [
    [
      ["a", bytes],
      ["b", bytes],
    ],
    [["a", bytes.subarray(1)]],
    [
      ["b", bytes],
      ["a", new Uint8Array([3])],
    ],
    Array.from({ length: 8193 }, (_, i) => [String(i), new Uint8Array([1])]),
  ])
    expect(() => copyDirectCompilationInitialization(entries)).toThrow();
});
test("metadata and byte shadow accessors reject without invoking getters", () => {
  let calls = 0;
  const get = () => {
    calls++;
    throw Error("getter invoked");
  };
  for (const scope of ["source", "hashes", "packages"]) {
    const p = pose();
    Object.defineProperty(
      scope === "source" ? p : p[scope],
      scope === "source" ? "policy" : "pose/a.bin",
      { get },
    );
    expect(() => copyDirectViewerPoseInitialization(p)).toThrow();
  }
  for (const key of ["buffer", "byteLength", "byteOffset", "constructor"]) {
    const b = new Uint8Array([1]);
    Object.defineProperty(b, key, { get });
    expect(() => copyDirectCompilationInitialization([["a", b]])).toThrow();
  }
  const b = new Uint8Array([1]);
  Object.setPrototypeOf(b, {});
  expect(() => copyDirectCompilationInitialization([["a", b]])).toThrow();
  expect(calls).toBe(0);
});
function receiver() {
  return {
    posts: 0,
    request(_type, payload, transfer) {
      this.posts++;
      const received = structuredClone(payload, { transfer });
      return Promise.resolve({
        initializationAccounting: {
          ...directInitializationBufferStats(received),
          workerAccountingMs: 0,
        },
      });
    },
  };
}
test("client defaults preserve payload across diagnostic clients and include complete client CPU", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const r = receiver(),
      out = await LatestDirectEffectClient.prototype.initialize.call(
        r,
        f.payload,
      );
    expect(out.initializationTransport.transferredBuffers).toBe(0);
    expect(
      out.initializationTransport.clientSynchronousPreparationMs,
    ).toBeGreaterThanOrEqual(out.initializationTransport.clientValidationCpuMs);
    await expect(
      LatestDirectEffectClient.prototype.initialize.call(r, f.payload),
    ).rejects.toThrow();
    expect(r.posts).toBe(1);
  }
  expect(f.payload.packages.compilationInputs[0][1].byteLength).toBe(4);
});
test("explicit client transfer and failed post are one-use before any second post", async () => {
  const f = fixture(),
    r = receiver(),
    out = await LatestDirectEffectClient.prototype.initialize.call(
      r,
      f.payload,
      { ownedInitialization: f.ticket },
    );
  expect(out.initializationTransport.transferredBufferBytes).toBe(7);
  expect(f.payload.packages.compilationInputs[0][1].byteLength).toBe(0);
  const failed = fixture(),
    bad = {
      posts: 0,
      request() {
        this.posts++;
        throw Error("post rejected");
      },
    };
  await expect(
    LatestDirectEffectClient.prototype.initialize.call(bad, failed.payload, {
      ownedInitialization: failed.ticket,
    }),
  ).rejects.toThrow("post rejected");
  await expect(
    LatestDirectEffectClient.prototype.initialize.call(bad, failed.payload, {
      ownedInitialization: failed.ticket,
    }),
  ).rejects.toThrow("one-use");
  expect(bad.posts).toBe(1);
  expect(() =>
    consumeDirectInitializationTransfer(failed.ticket, failed.payload),
  ).toThrow();
});
