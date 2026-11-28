import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mapBinHash } from "../map-scene-assets.mjs";
import { openChampionModelCatalog } from "./native-terrain-champion-model-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import {
  recordedAnimationRequests,
  supportsRecordedAnimationRequest,
} from "./recorded-animation-requests.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function verifySuccessor(cue, next) {
  assert.equal(
    next,
    cue.request.nextSameActorRequestSeconds,
    "Next animation request differs from the saved replay",
  );
}

function verifyRequestClocks(cues, replay, decompress) {
  const requested = new Map();
  for (const cue of cues) {
    const { context, request } = cue;
    const keys = requested.get(context) ?? new Map();
    requested.set(context, keys);
    const location = `${request.chunkId}:${request.blockOffset}`;
    assert.ok(!keys.has(location), "Duplicate recorded animation request");
    keys.set(location, cue);
  }
  const pending = new Map();
  let verified = 0;
  for (const packet of recordedAnimationRequests(
    replay,
    decompress,
    requested,
  )) {
    const { context, chunkId, blockOffset, timeSeconds } = packet;
    const previous = pending.get(context);
    if (previous) {
      verifySuccessor(previous, timeSeconds);
      pending.delete(context);
    }
    const cue = requested.get(context).get(`${chunkId}:${blockOffset}`);
    if (!cue) continue;
    assert.equal(timeSeconds, cue.timeSeconds);
    assert.equal(sha256(packet.payload), cue.request.payloadSha256);
    assert.equal(
      Buffer.from(packet.payload).toString("hex"),
      cue.request.payloadHex,
    );
    pending.set(context, cue);
    verified++;
  }
  for (const final of pending.values()) verifySuccessor(final, null);
  assert.equal(
    verified,
    cues.length,
    "Champion animation request is absent from the saved replay",
  );
}

async function readPinnedAnimationJson(path, pin) {
  const source = await readFile(path);
  assert.match(pin, /^[a-f0-9]{64}$/);
  assert.equal(
    sha256(source),
    pin,
    "Champion animation proof differs from its pin",
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
}

function createAnimationAssetLoader(path) {
  const routes = new Map();
  const reads = new Map();
  const clipDurations = new Map();
  async function loadAsset({ file, sha256: digest }, extension, mime) {
    assert.match(file, /^[\w.-]+$/u);
    assert.ok(file.endsWith(`.${extension}`));
    assert.match(digest, /^[a-f0-9]{64}$/);
    const route = `/champion-animations/${digest}.${extension}`;
    const key = file + ":" + digest;
    if (!reads.has(key)) {
      reads.set(
        key,
        readFile(join(dirname(path), file)).then((bytes) => {
          assert.equal(
            sha256(bytes),
            digest,
            "Recorded animation asset differs from its proof",
          );
          routes.set(route, [bytes, mime]);
        }),
      );
    }
    await reads.get(key);
    return route;
  }
  async function loadResources({ rig, clip, bindings, durationSeconds }) {
    assert.ok(Number.isFinite(durationSeconds) && durationSeconds > 0);
    const [rigUrl, clipUrl, bindingsUrl] = await Promise.all([
      loadAsset(rig, "skl", "application/octet-stream"),
      loadAsset(clip, "clip", "application/octet-stream"),
      loadAsset(bindings, "json", "application/json"),
    ]);
    if (!clipDurations.has(clipUrl)) {
      const clipBytes = routes.get(clipUrl)[0];
      const headerBytes = clipBytes.readUInt32LE();
      assert.ok(headerBytes > 0 && headerBytes < clipBytes.length - 4);
      const header = JSON.parse(clipBytes.toString("utf8", 4, 4 + headerBytes));
      assert.equal(header.schema, 1);
      clipDurations.set(clipUrl, header.duration);
    }
    assert.equal(
      clipDurations.get(clipUrl),
      durationSeconds,
      "Clip duration differs from proof",
    );
    return { rig: rigUrl, clip: clipUrl, bindings: bindingsUrl };
  }
  return { routes, loadResources };
}

export async function readRecordedChampionAnimations(
  path,
  pin,
  scene,
  replay,
  decompress,
) {
  const proof = await readPinnedAnimationJson(path, pin);
  assert.equal(proof.schema, 1);
  assert.equal(proof.kind, "recorded-champion-animation-cues");
  assert.equal(proof.build, scene.identity.build);
  assert.equal(proof.protocol, scene.identity.protocol);
  assert.equal(
    proof.replaySha256,
    scene.identity.replaySha256,
    "Champion animation belongs to another saved replay",
  );
  assert.ok(Array.isArray(proof.cues) && proof.cues.length > 0);
  verifyRequestClocks(proof.cues, replay, decompress);

  const { routes, loadResources } = createAnimationAssetLoader(path);
  const cues = [];
  for (const cue of proof.cues) {
    const {
      context: participantId,
      modelSha256,
      timeSeconds,
      endSeconds,
      durationSeconds,
      rate,
      request,
    } = cue;
    const model = scene.championModels?.bindings.find(
      (binding) => binding.participantId === participantId,
    );
    assert.equal(
      model?.url,
      `/champion-models/${modelSha256}.glb`,
      "Animation requires the same admitted champion model",
    );
    assert.equal(request.opcode, 669);
    assert.equal(request.context, participantId);
    assert.equal(request.stream, 1);
    assert.ok(
      supportsRecordedAnimationRequest(
        request.flags,
        request.adjustmentBits,
        request.overrideBits,
        replay.build,
      ),
      "Unsupported authored animation request fields",
    );
    assert.match(request.name, /^[A-Za-z0-9_]+$/u);
    assert.equal(mapBinHash(request.name), request.graphKey);
    assert.match(request.rateBits, /^[0-9a-f]{8}$/u);
    assert.ok(
      Number.isFinite(timeSeconds) &&
        timeSeconds >= 0 &&
        timeSeconds < scene.identity.durationMilliseconds / 1000,
    );
    const encodedRate = Buffer.from(request.rateBits, "hex").readFloatBE(0);
    assert.ok(Number.isFinite(rate) && rate > 0 && rate === encodedRate);
    assert.ok(Number.isFinite(durationSeconds) && durationSeconds > 0);
    assert.ok(
      Number.isFinite(endSeconds) &&
        endSeconds > timeSeconds &&
        endSeconds <= scene.identity.durationMilliseconds / 1000,
    );
    assert.equal(
      endSeconds,
      Math.min(
        timeSeconds + durationSeconds / rate,
        request.nextSameActorRequestSeconds ?? Infinity,
        scene.identity.durationMilliseconds / 1000,
      ),
      "Recorded animation window differs from the authored duration and request bounds",
    );
    const resources = await loadResources(cue);
    cues.push({
      participantId,
      model: model.url,
      timeSeconds,
      endSeconds,
      rate,
      ...resources,
    });
  }
  return { cues, routes };
}

/** Remove match clocks and actor identities from already verified authored cues. */
export function createCurrentChampionAnimationCatalog(
  { build, protocol },
  cues,
) {
  assert.equal(build, currentTerrainPositionBuild);
  assert.equal(protocol, terrainPositionProtocol);
  assert.ok(Array.isArray(cues) && cues.length > 0);
  const entries = new Map();
  for (const {
    modelSha256,
    durationSeconds,
    rig,
    clip,
    bindings,
    request: { name, graphKey, animationSha256, graphSha256 },
  } of cues) {
    const key = `${modelSha256}:${name}`;
    const entry = {
      modelSha256,
      name,
      graphKey,
      animationSha256,
      graphSha256,
      durationSeconds,
      rig,
      clip,
      bindings,
    };
    if (entries.has(key))
      assert.deepEqual(
        entries.get(key),
        entry,
        "Conflicting authored clip for the same model and animation name",
      );
    else entries.set(key, entry);
  }
  return {
    schema: 1,
    kind: "current-champion-animation-catalog",
    build,
    protocol,
    entries: [...entries.values()],
  };
}

async function readAuthoredAnimationCatalog(path, pin, identity) {
  const proof = await readPinnedAnimationJson(path, pin);
  assert.equal(proof.schema, 1);
  assert.equal(proof.kind, "current-champion-animation-catalog");
  assert.equal(proof.build, currentTerrainPositionBuild);
  assert.equal(proof.protocol, terrainPositionProtocol);
  assert.equal(proof.build, identity.build);
  assert.equal(proof.protocol, identity.protocol);
  assert.ok(Array.isArray(proof.entries) && proof.entries.length > 0);
  return proof;
}

async function loadAuthoredAnimationModels(path, entries, requireModel) {
  const { routes, loadResources } = createAnimationAssetLoader(path);
  const models = new Map();
  for (const entry of entries) {
    const {
      modelSha256,
      name,
      graphKey,
      durationSeconds,
      animationSha256,
      graphSha256,
    } = entry;
    assert.match(modelSha256, /^[a-f0-9]{64}$/u);
    assert.match(animationSha256, /^[a-f0-9]{64}$/u);
    assert.match(graphSha256, /^[a-f0-9]{64}$/u);
    assert.match(name, /^[A-Za-z0-9_]+$/u);
    assert.equal(graphKey, mapBinHash(name));
    const model = `/champion-models/${modelSha256}.glb`;
    if (!requireModel(model, entry)) continue;
    const resources = await loadResources(entry);
    const actor = models.get(model) ?? {
      actions: new Map(),
      rig: resources.rig,
      bindings: resources.bindings,
    };
    assert.equal(
      actor.rig,
      resources.rig,
      "Animation catalog model has inconsistent rig",
    );
    assert.equal(
      actor.bindings,
      resources.bindings,
      "Animation catalog model has inconsistent bindings",
    );
    assert.ok(
      !actor.actions.has(name),
      "Duplicate animation catalog name for admitted model",
    );
    actor.actions.set(name, { name, durationSeconds, ...resources });
    models.set(model, actor);
  }
  return { models, routes };
}

/** Bind reusable authored clips to admitted exact model digests. */
export async function readCurrentChampionAnimationCatalog(path, pin, scene) {
  const proof = await readAuthoredAnimationCatalog(path, pin, scene.identity);
  const admitted = new Set(
    scene.championModels?.bindings.map(({ url }) => url),
  );
  const { models, routes } = await loadAuthoredAnimationModels(
    path,
    proof.entries,
    (model) => admitted.has(model),
  );
  const bindings = [];
  for (const { participantId, url: model } of scene.championModels?.bindings ??
    []) {
    const authored = models.get(model);
    if (authored)
      bindings.push({
        participantId,
        model,
        actions: [...authored.actions.values()],
      });
  }
  return { bindings, routes };
}

/** Authenticate model, rig, and clip bindings before projecting an independent index. */
export async function readCurrentChampionAnimationModelCatalog(
  path,
  pin,
  { modelManifestPath, modelManifestSha256, identity },
) {
  const [proof, { catalog }] = await Promise.all([
    readAuthoredAnimationCatalog(path, pin, identity),
    openChampionModelCatalog(
      modelManifestPath,
      modelManifestSha256,
      identity,
      undefined,
      { requireArchive: true },
    ),
  ]);
  assert.deepEqual(Object.keys(proof).sort(), [
    "build",
    "entries",
    "kind",
    "protocol",
    "schema",
  ]);
  const modelsByDigest = new Map();
  for (const asset of Object.values(catalog.assets)) {
    const digest = asset.model.sha256;
    const binding = [
      asset.inputs?.skeleton?.sha256,
      asset.jointBindings?.sha256,
    ];
    if (modelsByDigest.has(digest))
      assert.deepEqual(
        modelsByDigest.get(digest),
        binding,
        "Same model digest has inconsistent rig provenance",
      );
    modelsByDigest.set(digest, binding);
  }
  const { models, routes } = await loadAuthoredAnimationModels(
    path,
    proof.entries,
    (_model, entry) => {
      assert.deepEqual(Object.keys(entry).sort(), [
        "animationSha256",
        "bindings",
        "clip",
        "durationSeconds",
        "graphKey",
        "graphSha256",
        "modelSha256",
        "name",
        "rig",
      ]);
      const binding = modelsByDigest.get(entry.modelSha256);
      assert.ok(
        binding !== undefined,
        "Animation model is absent from the pinned archive catalog",
      );
      assert.deepEqual(
        [entry.rig.sha256, entry.bindings.sha256],
        binding,
        "Animation rig or joint bindings disagree with the pinned model",
      );
      return true;
    },
  );
  const { build, protocol } = proof;
  return {
    championAnimationModelCatalog: {
      build,
      protocol,
      models: [...models].map(([model, { actions }]) => ({
        model,
        actions: [...actions.values()],
      })),
    },
    routes,
  };
}
