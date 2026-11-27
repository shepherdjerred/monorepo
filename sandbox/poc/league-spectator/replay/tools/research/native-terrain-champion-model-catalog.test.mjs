import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  championArchiveExecutableHashes,
  corroborateChampionModelSelections,
  currentChampionBuild,
  loadChampionModelCatalog,
  loadChampionModelCatalogIndex,
  openChampionModelCatalog,
} from "./native-terrain-champion-model-catalog.mjs";
import {
  indexCurrentChampionOpening,
  prepareCurrentChampionModelBindings,
} from "./native-terrain-champion-opening.mjs";

const identity = { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const heroes = Array.from({ length: 10 }, (_, index) => ({
  champion: `Champion${index}`,
  context: 1000 + index,
  skinId: index,
}));
const observations = {
  roster: heroes.map(({ champion }) => ({ champion })),
  binding: {
    unresolved: [],
    verified: heroes.map(({ context }, index) => ({
      context,
      footerRow: index + 1,
    })),
  },
};

test("authenticates all archive models before exporting a replay-independent index", async () => {
  const root = await mkdtemp(join(tmpdir(), "scout-champion-index-"));
  try {
    const current = { ...identity, build: currentChampionBuild };
    const manifest = join(root, "catalog.json");
    const file = "ahri-27/model.glb";
    const bytes = Buffer.alloc(16);
    bytes.write("glTF");
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(bytes.length, 8);
    const model = { file, sha256: sha256(bytes), bytes: bytes.length };
    const asset = {
      champion: "Ahri",
      skinId: 27,
      skinScale: null,
      hiddenRanges: [],
      model,
    };
    const catalog = {
      schema: 1,
      kind: "exact-native-terrain-champion-catalog",
      ...current,
      selectionKind: "archive",
      installedExeSha256: championArchiveExecutableHashes[current.build],
      sourceManifestSha256: "a".repeat(64),
      sourceCensusSha256: "b".repeat(64),
      selectionSha256: "c".repeat(64),
      assets: { "ahri-27": { ...asset, archiveIndexSha256: "d".repeat(64) } },
    };
    const write = async (value) => {
      const content = JSON.stringify(value);
      await writeFile(manifest, content);
      return sha256(content);
    };
    await mkdir(join(root, "ahri-27"));
    await writeFile(join(root, file), bytes);
    const pin = await write(catalog);
    const { championModelCatalog, routes } =
      await loadChampionModelCatalogIndex(manifest, pin, current);
    expect(championModelCatalog.assets).toEqual({ "ahri-27": asset });
    expect(championModelCatalog).not.toHaveProperty("installedExeSha256");
    expect(routes.get(`/champion-models/${model.sha256}.glb`)).toEqual([
      bytes,
      "model/gltf-binary",
    ]);
    await writeFile(join(root, file), Buffer.alloc(16));
    await expect(
      loadChampionModelCatalogIndex(manifest, pin, current),
    ).rejects.toThrow("model digest differs");
    await expect(
      loadChampionModelCatalogIndex(
        manifest,
        await write({
          ...catalog,
          assets: { "ahri-9": catalog.assets["ahri-27"] },
        }),
        current,
      ),
    ).rejects.toThrow("model key differs");
    await expect(
      loadChampionModelCatalogIndex(
        manifest,
        await write({ ...catalog, selectionKind: undefined }),
        current,
      ),
    ).rejects.toThrow("build-scoped archive catalog");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("requires a one-to-one corroborated opening roster", () => {
  const reordered = heroes.toReversed();
  expect(corroborateChampionModelSelections(observations, reordered)).toEqual(
    reordered,
  );
  expect(() =>
    corroborateChampionModelSelections(observations, [
      { ...heroes[0], champion: heroes[1].champion },
      ...heroes.slice(1),
    ]),
  ).toThrow("disagrees with its footer row");
  expect(() =>
    corroborateChampionModelSelections(observations, [
      heroes[1],
      ...heroes.slice(1),
    ]),
  ).toThrow("Duplicate opening creation context");
});

test("indexes only original selections from the independent exact-build catalog", () => {
  const current = { ...observations, ...identity, build: currentChampionBuild };
  const assets = Object.fromEntries(
    heroes.map((hero) => [
      `${hero.champion.toLowerCase()}-${hero.skinId}`,
      hero,
    ]),
  );
  const catalog = {
    schema: 1,
    kind: "exact-native-terrain-champion-catalog",
    build: current.build,
    protocol: current.protocol,
    selectionKind: "archive",
    assets,
  };
  const reordered = heroes.toReversed();
  expect([...indexCurrentChampionOpening(catalog, current, reordered)]).toEqual(
    reordered.map((hero) => [hero.context, hero]),
  );
  expect(() =>
    indexCurrentChampionOpening(catalog, { ...current, ...identity }, heroes),
  ).toThrow("exact current champion opening");
  expect(() =>
    indexCurrentChampionOpening(
      catalog,
      { ...current, protocol: "foreign" },
      heroes,
    ),
  ).toThrow("exact current champion opening");
  expect(() =>
    indexCurrentChampionOpening(
      { ...catalog, nativeOpening: {} },
      current,
      heroes,
    ),
  ).toThrow("independent exact-build");
  expect(() =>
    indexCurrentChampionOpening(
      { ...catalog, replaySha256: "fixture" },
      current,
      heroes,
    ),
  ).toThrow("independent exact-build");
  expect(() =>
    indexCurrentChampionOpening(catalog, current, [
      { ...heroes[0], skinId: 99 },
      ...heroes.slice(1),
    ]),
  ).toThrow("Missing exact champion skin");
  expect(() =>
    indexCurrentChampionOpening(
      { ...catalog, assets: { ...assets, "champion0-0": heroes[1] } },
      current,
      heroes,
    ),
  ).toThrow("disagrees with its opening skin selector");
});

test("projects only digest-bound models in opening packet order", () => {
  const current = { ...observations, ...identity, build: currentChampionBuild };
  const modelSha256 = "a".repeat(64);
  const assets = Object.fromEntries(
    heroes.map(({ champion, skinId }) => {
      const key = `${champion.toLowerCase()}-${skinId}`;
      return [
        key,
        {
          champion,
          skinId,
          skinScale: null,
          hiddenRanges: ["Hidden"],
          model: { file: `${key}/model.glb`, sha256: modelSha256, bytes: 16 },
        },
      ];
    }),
  );
  const catalog = {
    schema: 1,
    kind: "exact-native-terrain-champion-catalog",
    build: current.build,
    protocol: current.protocol,
    selectionKind: "archive",
    assets,
  };
  const reversed = heroes.toReversed();
  expect(
    prepareCurrentChampionModelBindings(catalog, current, reversed).bindings,
  ).toEqual(
    reversed.map(({ context, skinId }) => ({
      participantId: context,
      skinId,
      skinScale: 1,
      hiddenRanges: ["Hidden"],
      url: `/champion-models/${modelSha256}.glb`,
    })),
  );
  const entry = assets["champion0-0"];
  assets["champion0-0"] = {
    ...entry,
    model: { ...entry.model, sha256: "../wrong" },
  };
  expect(() =>
    prepareCurrentChampionModelBindings(catalog, current, heroes),
  ).toThrow("Invalid build-scoped champion model resource");
});

test("loads pinned build-authored GLBs for the decoded skin selectors", async () => {
  const root = await mkdtemp(join(tmpdir(), "scout-champion-catalog-"));
  try {
    const manifest = join(root, "catalog.json");
    const modelBytes = Buffer.alloc(16);
    modelBytes.write("glTF");
    modelBytes.writeUInt32LE(2, 4);
    modelBytes.writeUInt32LE(modelBytes.length, 8);
    const assets = {};
    for (const { champion, skinId } of heroes) {
      const key = `${champion.toLowerCase()}-${skinId}`;
      const file = `${key}/model.glb`;
      await mkdir(join(root, key));
      await writeFile(join(root, file), modelBytes);
      assets[key] = {
        champion,
        skinId,
        skinScale: 1.1,
        hiddenRanges: ["Hidden"],
        model: { file, bytes: modelBytes.length, sha256: sha256(modelBytes) },
      };
    }
    const contents = JSON.stringify({
      schema: 1,
      kind: "exact-native-terrain-champion-catalog",
      ...identity,
      assets,
    });
    await writeFile(manifest, contents);
    const pin = sha256(contents);
    const selections = corroborateChampionModelSelections(observations, heroes);
    const loaded = await loadChampionModelCatalog(
      manifest,
      pin,
      identity,
      selections,
    );
    expect(
      loaded.bindings.map(({ participantId, skinId }) => [
        participantId,
        skinId,
      ]),
    ).toEqual(selections.map(({ context, skinId }) => [context, skinId]));
    expect(loaded.routes.get(loaded.bindings[0].url)).toEqual([
      modelBytes,
      "model/gltf-binary",
    ]);
    await expect(
      loadChampionModelCatalog(
        manifest,
        pin,
        { ...identity, build: "16.23.839.9929" },
        selections,
      ),
    ).rejects.toThrow("build differs");
    await expect(
      loadChampionModelCatalog(manifest, pin, identity, [
        { ...selections[0], skinId: 1 },
        ...selections.slice(1),
      ]),
    ).rejects.toThrow("Missing exact champion skin");
    await writeFile(manifest, contents + " ");
    await expect(
      loadChampionModelCatalog(manifest, pin, identity, selections),
    ).rejects.toThrow("catalog digest differs");
    await writeFile(manifest, contents);
    const altered = Buffer.from(modelBytes);
    altered[15] = 1;
    await writeFile(join(root, assets["champion0-0"].model.file), altered);
    await expect(
      loadChampionModelCatalog(manifest, pin, identity, selections),
    ).rejects.toThrow("Champion model digest differs");

    await writeFile(join(root, assets["champion0-0"].model.file), modelBytes);
    const current = {
      ...identity,
      build: currentChampionBuild,
      replaySha256: "a".repeat(64),
    };
    const currentCatalog = {
      ...JSON.parse(contents),
      build: current.build,
      installedExeSha256: championArchiveExecutableHashes[current.build],
      sourceCensusSha256: "b".repeat(64),
    };
    const uncorroborated = JSON.stringify(currentCatalog);
    await writeFile(manifest, uncorroborated);
    await expect(
      loadChampionModelCatalog(
        manifest,
        sha256(uncorroborated),
        current,
        selections,
      ),
    ).rejects.toThrow("Native opening roster required");
    const corroborated = JSON.stringify({
      ...currentCatalog,
      nativeOpening: {
        rows: heroes,
        replaySha256: current.replaySha256,
        nativeLogSha256: "c".repeat(64),
        proofSha256: "d".repeat(64),
      },
    });
    await writeFile(manifest, corroborated);
    const currentPin = sha256(corroborated);
    expect(
      (
        await loadChampionModelCatalog(
          manifest,
          currentPin,
          current,
          selections,
        )
      ).bindings,
    ).toEqual(loaded.bindings);
    await expect(
      loadChampionModelCatalog(
        manifest,
        currentPin,
        { ...current, replaySha256: "e".repeat(64) },
        selections,
      ),
    ).rejects.toThrow("Native roster belongs to another replay");
    await expect(
      loadChampionModelCatalog(manifest, currentPin, current, [
        { ...selections[0], skinId: 1 },
        ...selections.slice(1),
      ]),
    ).rejects.toThrow("Opening selection disagrees with the native roster");

    const archiveCatalog = {
      ...currentCatalog,
      selectionKind: "archive",
      selectionSha256: "f".repeat(64),
      sourceManifestSha256: "1".repeat(64),
    };
    const archive = JSON.stringify(archiveCatalog);
    const archivePin = sha256(archive);
    await writeFile(manifest, archive);
    const otherMatch = { ...current, replaySha256: "e".repeat(64) };
    const otherSelections = selections.map((selection) => ({
      ...selection,
      context: selection.context + 100,
    }));
    expect(
      (
        await loadChampionModelCatalog(
          manifest,
          archivePin,
          current,
          selections,
        )
      ).bindings,
    ).toEqual(loaded.bindings);
    expect(
      (
        await loadChampionModelCatalog(
          manifest,
          archivePin,
          otherMatch,
          otherSelections,
        )
      ).bindings,
    ).toEqual(
      loaded.bindings.map((entry) => ({
        ...entry,
        participantId: entry.participantId + 100,
      })),
    );
    await expect(
      loadChampionModelCatalog(manifest, archivePin, otherMatch, [
        { ...otherSelections[0], skinId: 1 },
        ...otherSelections.slice(1),
      ]),
    ).rejects.toThrow("Missing exact champion skin");
    const mixed = JSON.stringify({
      ...archiveCatalog,
      nativeOpening: JSON.parse(corroborated).nativeOpening,
    });
    const opened = await openChampionModelCatalog(
      manifest,
      archivePin,
      otherMatch,
      [],
      {
        maxManifestBytes: Buffer.byteLength(archive),
        maxModelBytes: modelBytes.length,
      },
    );
    const bounded = await openChampionModelCatalog(
      manifest,
      archivePin,
      otherMatch,
      [],
      { maxModelBytes: modelBytes.length - 1 },
    );
    await expect(bounded.readModel(otherSelections[0])).rejects.toThrow(
      "audit size bound",
    );
    await writeFile(manifest, mixed);
    expect((await opened.readModel(otherSelections[0])).bytes).toEqual(
      modelBytes,
    );
    await expect(
      loadChampionModelCatalog(
        manifest,
        sha256(mixed),
        otherMatch,
        otherSelections,
      ),
    ).rejects.toThrow("cannot contain a match opening");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
