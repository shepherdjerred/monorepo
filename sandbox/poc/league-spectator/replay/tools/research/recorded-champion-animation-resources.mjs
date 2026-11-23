import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mapBinHash } from "../map-scene-assets.mjs";
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

export async function readRecordedChampionAnimations(
  path,
  pin,
  scene,
  replay,
  decompress,
) {
  const source = await readFile(path);
  assert.match(pin, /^[a-f0-9]{64}$/);
  assert.equal(
    sha256(source),
    pin,
    "Champion animation proof differs from its pin",
  );
  const proof = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(source),
  );
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
    const [rig, clip, bindings] = await Promise.all([
      loadAsset(cue.rig, "skl", "application/octet-stream"),
      loadAsset(cue.clip, "clip", "application/octet-stream"),
      loadAsset(cue.bindings, "json", "application/json"),
    ]);
    if (!clipDurations.has(clip)) {
      const clipBytes = routes.get(clip)[0];
      const headerBytes = clipBytes.readUInt32LE();
      assert.ok(headerBytes > 0 && headerBytes < clipBytes.length - 4);
      const header = JSON.parse(clipBytes.toString("utf8", 4, 4 + headerBytes));
      assert.equal(header.schema, 1);
      clipDurations.set(clip, header.duration);
    }
    assert.equal(
      clipDurations.get(clip),
      durationSeconds,
      "Clip duration differs from cue",
    );
    cues.push({
      participantId,
      model: model.url,
      timeSeconds,
      endSeconds,
      rate,
      rig,
      clip,
      bindings,
    });
  }
  return { cues, routes };
}
