import { expect, test } from "bun:test";
import { sha256 } from "./structural-comparison.mjs";
import {
  loadLatestStaticCatalogSelection,
  restoreLatestStaticCatalogSelection,
  assertLatestStaticCatalogSelection,
  isLatestStaticCatalogSelection,
  STATIC_CATALOG_POLICY,
  STATIC_CATALOG_DECODER_IMAGE_SHA256,
} from "./latest-static-catalog.mjs";
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
async function fixture(mutate = () => {}) {
  const image = STATIC_CATALOG_DECODER_IMAGE_SHA256,
    files = {},
    roots = {
      scene: {
        build: "16.21.829.8620",
        protocol: "20e09df23c66b85e",
        map: { id: 12, variant: "base" },
      },
      effects: {
        build: "16.21.829.8620",
        protocol: "20e09df23c66b85e",
        definitions: {},
      },
    };
  const put = (path, value) => (files[path] = encode(value));
  put("latest-scene/manifest.json", roots.scene);
  roots.effects.sceneManifestSha256 = await sha256(
    files["latest-scene/manifest.json"],
  );
  put("latest-effects/manifest.json", roots.effects);
  put("latest-effect-contexts/package.json", {
    build: roots.scene.build,
    protocol: roots.scene.protocol,
    kind: "prepared-character-effect-contexts",
    decoderImageSha256: image,
    effectsManifestSha256: await sha256(files["latest-effects/manifest.json"]),
  });
  put("latest-viewer-poses/package.json", {
    build: roots.scene.build,
    protocol: roots.scene.protocol,
    kind: "pinned-static-viewer-pose-assets",
    decoderImageSha256: image,
    sceneManifestSha256: await sha256(files["latest-scene/manifest.json"]),
  });
  put("latest-scene/leaf.json", { lanes: [1, 2, 3] });
  const catalog = {
    schema: 1,
    kind: "prepared-selected-static-content",
    policy: STATIC_CATALOG_POLICY,
    build: roots.scene.build,
    protocol: roots.scene.protocol,
    decoderImageSha256: image,
    map: { id: 12, presentationVariant: "base" },
    roles: {
      scene: "latest-scene/manifest.json",
      effects: "latest-effects/manifest.json",
      effectContexts: "latest-effect-contexts/package.json",
      viewerPoses: "latest-viewer-poses/package.json",
    },
    files: {},
  };
  for (const [path, bytes] of Object.entries(files))
    catalog.files[path] = { sha256: await sha256(bytes), bytes: bytes.length };
  mutate({ catalog, files, roots });
  put("latest-static-catalog/catalog.json", catalog);
  put("decoder-16.21-macos/profile.json", {
    clientVersion: roots.scene.build,
    protocolDigest: roots.scene.protocol,
    decoderImageSha256: image,
  });
  put("latest-static-catalog/bootstrap.json", {
    schema: 1,
    kind: "trusted-static-content-bootstrap",
    profile: {
      path: "decoder-16.21-macos/profile.json",
      sha256: await sha256(files["decoder-16.21-macos/profile.json"]),
    },
    catalog: {
      path: "latest-static-catalog/catalog.json",
      sha256: await sha256(files["latest-static-catalog/catalog.json"]),
    },
  });
  return {
    files,
    load: async (path) => {
      if (!Object.hasOwn(files, path))
        throw Error("Missing fixture input: " + path);
      return files[path];
    },
  };
}
test("trusted bootstrap selects owned content and caller mutations cannot escape byte/inventory copies", async () => {
  const f = await fixture(),
    selected = await loadLatestStaticCatalogSelection(f);
  expect(isLatestStaticCatalogSelection(selected)).toBe(true);
  const bytes = await selected.read("latest-scene/leaf.json"),
    inventory = selected.describe();
  bytes[0] ^= 1;
  inventory.map.id = 1;
  expect(await selected.read("latest-scene/leaf.json")).toEqual(
    f.files["latest-scene/leaf.json"],
  );
  expect(selected.describe().map.id).toBe(12);
  expect(selected.scope.nativeMaterialAdmissionEstablished).toBe(false);
  expect(() => assertLatestStaticCatalogSelection({ ...selected })).toThrow(
    "Owned selected",
  );
});
test("caller expected hashes cannot replace the bootstrap-selected digest", async () => {
  const f = await fixture();
  f.files["latest-static-catalog/catalog.json"][0] ^= 1;
  await expect(
    loadLatestStaticCatalogSelection({
      ...f,
      expectedHash: await sha256(f.files["latest-static-catalog/catalog.json"]),
    }),
  ).rejects.toThrow("digest differs");
});
test("stale selected role bytes and absent catalog files fail explicitly", async () => {
  const f = await fixture();
  f.files["latest-effect-contexts/package.json"][0] ^= 1;
  await expect(loadLatestStaticCatalogSelection(f)).rejects.toThrow(
    "Selected static file differs",
  );
  const missing = await fixture();
  delete missing.files["latest-viewer-poses/package.json"];
  await expect(loadLatestStaticCatalogSelection(missing)).rejects.toThrow(
    "Missing fixture input",
  );
});
test("a rehashed trusted catalog still cannot bind a foreign scene or effects root", async () => {
  for (const mutate of [
    ({ catalog }) => {
      catalog.map.id = 1;
    },
    ({ catalog, files }) => {
      const path = catalog.roles.effectContexts;
      const value = JSON.parse(new TextDecoder().decode(files[path]));
      value.effectsManifestSha256 = "2".repeat(64);
      files[path] = encode(value);
    },
  ]) {
    const f = await fixture(mutate);
    // Refresh only this deliberately supplied trusted catalog's file inventory.
    const catalog = JSON.parse(
      new TextDecoder().decode(f.files["latest-static-catalog/catalog.json"]),
    );
    for (const path of Object.keys(catalog.files))
      catalog.files[path] = {
        sha256: await sha256(f.files[path]),
        bytes: f.files[path].length,
      };
    f.files["latest-static-catalog/catalog.json"] = encode(catalog);
    const bootstrap = JSON.parse(
      new TextDecoder().decode(f.files["latest-static-catalog/bootstrap.json"]),
    );
    bootstrap.catalog.sha256 = await sha256(
      f.files["latest-static-catalog/catalog.json"],
    );
    f.files["latest-static-catalog/bootstrap.json"] = encode(bootstrap);
    await expect(loadLatestStaticCatalogSelection(f)).rejects.toThrow(
      "root closure differs",
    );
  }
});
test("catalog roles and paths cannot escape the declared closed static inventory", async () => {
  for (const mutate of [
    ({ catalog }) => {
      catalog.roles.effectContexts = "missing.json";
    },
    ({ catalog }) => {
      catalog.files["../foreign.json"] = { sha256: "3".repeat(64), bytes: 1 };
    },
    ({ catalog }) => {
      catalog.roles.viewerPoses = catalog.roles.scene;
    },
  ])
    await expect(
      loadLatestStaticCatalogSelection(await fixture(mutate)),
    ).rejects.toThrow();
});
test("worker restores the same captured selection and rejects altered derived inventory or root bytes", async () => {
  const f = await fixture(),
    selected = await loadLatestStaticCatalogSelection(f),
    initialization = selected.serializeForWorker();
  const worker = await restoreLatestStaticCatalogSelection({
    initialization,
    load: f.load,
  });
  expect(worker.describe()).toEqual(selected.describe());
  expect(await worker.read("latest-scene/leaf.json")).toEqual(
    await selected.read("latest-scene/leaf.json"),
  );
  const changed = structuredClone(initialization);
  changed.inventory.map.id = 1;
  await expect(
    restoreLatestStaticCatalogSelection({
      initialization: changed,
      load: f.load,
    }),
  ).rejects.toThrow("inventory differs");
  const root = structuredClone(initialization);
  root.roots["latest-effects/manifest.json"][0] ^= 1;
  await expect(
    restoreLatestStaticCatalogSelection({ initialization: root, load: f.load }),
  ).rejects.toThrow("file differs");
});
test("worker graph validation rejects getters before execution and unknown root bytes", async () => {
  const f = await fixture(),
    selected = await loadLatestStaticCatalogSelection(f),
    initialization = selected.serializeForWorker();
  let called = 0;
  Object.defineProperty(initialization, "inventory", {
    get() {
      called++;
      return {};
    },
    enumerable: true,
  });
  await expect(
    restoreLatestStaticCatalogSelection({ initialization, load: f.load }),
  ).rejects.toThrow("Own data");
  expect(called).toBe(0);
  const extra = selected.serializeForWorker();
  extra.roots["foreign.json"] = new Uint8Array();
  await expect(
    restoreLatestStaticCatalogSelection({
      initialization: extra,
      load: f.load,
    }),
  ).rejects.toThrow("inventory differs");
});
test("bootstrap cannot pair a foreign profile and changing all content hashes cannot approve another native image", async () => {
  const f = await fixture();
  f.files["decoder-16.21-macos/profile.json"][0] ^= 1;
  await expect(loadLatestStaticCatalogSelection(f)).rejects.toThrow();
  const forged = await fixture();
  const profile = JSON.parse(
    new TextDecoder().decode(forged.files["decoder-16.21-macos/profile.json"]),
  );
  profile.decoderImageSha256 = "f".repeat(64);
  forged.files["decoder-16.21-macos/profile.json"] = encode(profile);
  const bootstrap = JSON.parse(
    new TextDecoder().decode(
      forged.files["latest-static-catalog/bootstrap.json"],
    ),
  );
  bootstrap.profile.sha256 = await sha256(
    forged.files["decoder-16.21-macos/profile.json"],
  );
  forged.files["latest-static-catalog/bootstrap.json"] = encode(bootstrap);
  await expect(loadLatestStaticCatalogSelection(forged)).rejects.toThrow(
    "compatible prepared catalog",
  );
});
test("selected roots survive later backing mutations and host/worker catalog substitution is rejected", async () => {
  const f = await fixture(),
    selected = await loadLatestStaticCatalogSelection(f),
    original = await selected.readRole("scene");
  f.files["latest-scene/manifest.json"][0] ^= 1;
  expect(await selected.readRole("scene")).toEqual(original);
  await expect(
    selected.assertRole("scene", f.files["latest-scene/manifest.json"]),
  ).rejects.toThrow("Consumer bytes differ");
  const other = await fixture(({ catalog }) => {
    catalog.files["extra.json"] = {
      sha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      bytes: 0,
    };
  });
  const initialization = selected.serializeForWorker();
  initialization.bootstrapBytes =
    other.files["latest-static-catalog/bootstrap.json"];
  await expect(
    restoreLatestStaticCatalogSelection({ initialization, load: other.load }),
  ).rejects.toThrow("digest differs");
});
test("binding initialization reuses exact owned root spans and rejects foreign bytes before transfer", async () => {
  const f = await fixture(),
    selection = await loadLatestStaticCatalogSelection(f),
    snapshot = selection.serializeForWorker();
  const packages = {
    ...snapshot.roots,
    "latest-static-catalog/bootstrap.json": snapshot.bootstrapBytes,
    "decoder-16.21-macos/profile.json": snapshot.profileBytes,
    [snapshot.inventory.catalogPath]: snapshot.catalogBytes,
  };
  const bound = await selection.bindWorkerInitialization(packages);
  expect(bound.bootstrapBytes.buffer).toBe(
    packages["latest-static-catalog/bootstrap.json"].buffer,
  );
  expect(bound.roots["latest-scene/manifest.json"].buffer).toBe(
    packages["latest-scene/manifest.json"].buffer,
  );
  const worker = await restoreLatestStaticCatalogSelection({
    initialization: bound,
    load: f.load,
  });
  expect(worker.describe()).toEqual(selection.describe());
  packages["latest-scene/manifest.json"][0] ^= 1;
  await expect(selection.bindWorkerInitialization(packages)).rejects.toThrow(
    "differs from selected root",
  );
  let called = 0;
  const invalid = {
    get malicious() {
      called++;
      return null;
    },
  };
  await expect(selection.bindWorkerInitialization(invalid)).rejects.toThrow();
  expect(called).toBe(0);
});
test("cached native verifier rejects malformed blocks and content roots cannot reapprove a foreign image", async () => {
  const bytes = new Uint8Array([1, 2, 3]),
    digest = await sha256(bytes);
  const f = await fixture(({ catalog, files }) => {
    files["decoder-16.21-macos/image.bin"] = bytes;
    catalog.files["decoder-16.21-macos/image.bin"] = {
      sha256: digest,
      bytes: bytes.length,
    };
  });
  const selection = await loadLatestStaticCatalogSelection(f);
  await expect(selection.verifyNativeImageBlocks([])).rejects.toThrow(
    "Bounded native instruction",
  );
  await expect(
    selection.verifyNativeImageBlocks([{ rva: 0, size: 3, sha256: digest }]),
  ).rejects.toThrow("Fixed original native image");
  const metrics = selection.initializationMetrics().nativeImage;
  expect(metrics.captureCopyBytes).toBe(3);
  expect(metrics.readCopies).toBe(0);
  metrics.captureCopyBytes = 999;
  expect(selection.initializationMetrics().nativeImage.captureCopyBytes).toBe(
    3,
  );
});
