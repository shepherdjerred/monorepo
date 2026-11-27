import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mapBinHash } from "../map-scene-assets.mjs";
import { championArchiveExecutableHashes } from "./native-terrain-champion-model-catalog.mjs";
import {
  readCurrentChampionAnimationCatalog,
  readCurrentChampionAnimationModelCatalog,
} from "./recorded-champion-animation-resources.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = { build: "16.23.841.8428", protocol: "8bbfcd5af2bc92db" };

test("projects exact authored actions without match bindings and seals them to the model rig", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-animation-catalog-"));
  try {
    const save = async (file, bytes) => {
      await writeFile(join(dir, file), bytes);
      return { file, sha256: sha256(bytes) };
    };
    const header = Buffer.from(JSON.stringify({ schema: 1, duration: 2 }));
    const clipBytes = Buffer.alloc(5 + header.length);
    clipBytes.writeUInt32LE(header.length);
    header.copy(clipBytes, 4);
    const rig = await save("model.skl", Buffer.of(1));
    const clip = await save("model.clip", clipBytes);
    const bindings = await save("model.json", "{}");
    const modelSha256 = "0".repeat(64);
    const entry = {
      modelSha256,
      name: "Spell1",
      graphKey: mapBinHash("Spell1"),
      animationSha256: "1".repeat(64),
      graphSha256: "2".repeat(64),
      durationSeconds: 2,
      rig,
      clip,
      bindings,
    };
    const proof = {
      schema: 1,
      kind: "current-champion-animation-catalog",
      ...identity,
      entries: [entry],
    };
    const proofPath = join(dir, "animation-catalog.json");
    const models = {
      schema: 1,
      kind: "exact-native-terrain-champion-catalog",
      ...identity,
      selectionKind: "archive",
      installedExeSha256: championArchiveExecutableHashes[identity.build],
      sourceCensusSha256: "3".repeat(64),
      sourceManifestSha256: "4".repeat(64),
      selectionSha256: "5".repeat(64),
      assets: {
        "ahri-0": {
          model: { sha256: modelSha256 },
          inputs: { skeleton: rig },
          jointBindings: bindings,
        },
      },
    };
    const { sha256: modelManifestSha256 } = await save(
      "models.json",
      JSON.stringify(models),
    );
    const options = {
      modelManifestPath: join(dir, "models.json"),
      modelManifestSha256,
      identity,
    };
    const { sha256: pin } = await save(
      "animation-catalog.json",
      JSON.stringify(proof),
    );
    const direct = await readCurrentChampionAnimationModelCatalog(
      proofPath,
      pin,
      options,
    );
    const [model] = direct.championAnimationModelCatalog.models;
    const prepared = await readCurrentChampionAnimationCatalog(proofPath, pin, {
      identity,
      championModels: { bindings: [{ participantId: 100, url: model.model }] },
    });
    assert.deepEqual(prepared.bindings, [{ participantId: 100, ...model }]);
    assert.deepEqual(prepared.routes, direct.routes);
    const wrongRig = {
      ...proof,
      entries: [{ ...entry, rig: { ...rig, sha256: "9".repeat(64) } }],
    };
    const wrongPin = (
      await save("animation-catalog.json", JSON.stringify(wrongRig))
    ).sha256;
    await assert.rejects(
      readCurrentChampionAnimationModelCatalog(proofPath, wrongPin, options),
      /rig or joint bindings disagree/,
    );
    await save("animation-catalog.json", JSON.stringify(proof));
    await save("model.clip", Buffer.alloc(clipBytes.length));
    await assert.rejects(
      readCurrentChampionAnimationModelCatalog(proofPath, pin, options),
      /asset differs/,
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
