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
} from "./native-terrain-champion-model-catalog.mjs";

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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
