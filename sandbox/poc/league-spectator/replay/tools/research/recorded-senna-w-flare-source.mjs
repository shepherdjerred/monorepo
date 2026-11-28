import assert from "node:assert/strict";
import { readLocalRecordedParticles } from "../build-local-scout-terrain-package.mjs";

export const sennaWFlareFamily = "senna-w-ground-impact-flare";
const sennaWKey = 0x6bb08197;
const sennaWKeyHex = "6bb08197";
const sennaWLength = Math.fround(0.12);
const sennaWScale = Math.fround(0.9);

// The reference producer authenticated the exact WAD definition, original
// shaders, converted texture mips, and archived-emitter vertex writes. This
// source uses its static components and does not consume its replay events.
export async function readRecordedSennaFlareAssets(referenceTrack) {
  const manifest = "recorded-particles.json";
  const files = await readLocalRecordedParticles(
    referenceTrack,
    "65b479b322de6c3285e9378082c22d242d21780b524757f5f5bde31fb51f67c3",
    {
      build: "16.23.841.8428",
      replaySha256:
        "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
    },
  );
  const reference = JSON.parse(files.get(manifest));
  const family = reference.families.find(({ id }) => id === sennaWFlareFamily);
  assert.equal(family.components.length, 2);
  for (const component of family.components) {
    assert.equal(component.lifetime, sennaWLength);
    assert.equal(component.alphaTest, true);
    assert.equal(component.depthTest, false);
  }
  const { vertex, fragment } = reference.shaders;
  const textures = [
    ...new Set(
      family.components.flatMap(({ texture, palette }) => [texture, palette]),
    ),
  ];
  return {
    family,
    textures: { files: textures },
    shaders: { vertex, fragment },
    files: new Map(
      [...textures, vertex, fragment].map((path) => [path, files.get(path)]),
    ),
  };
}

const exactPlacement = (point) =>
  Array.isArray(point) &&
  point.length === 3 &&
  point.every(
    (value) => typeof value === "number" && Number.isFinite(Math.fround(value)),
  );
const zeroPlacement = (point) =>
  exactPlacement(point) && point.every((value) => value === 0);

function isSupportedPlacement(event) {
  if (
    event.context !== 0 ||
    event.parent !== 0 ||
    event.status !== "detached-placement-confirmed"
  )
    return false;
  const descriptor = event.descriptor;
  assert.equal(descriptor.resourceKey, event.resourceKey);
  const [position, second, third] = descriptor.positions;
  return (
    descriptor.flags === 0x20 &&
    descriptor.positions.length === 3 &&
    exactPlacement(position) &&
    zeroPlacement(second) &&
    zeroPlacement(third) &&
    descriptor.scaleRate.length === 2 &&
    descriptor.scaleRate[0] === sennaWScale &&
    descriptor.scaleRate[1] === 1
  );
}

function isExactFlareDefinition(definition) {
  if (
    definition?.archive !== "DATA/FINAL/Champions/Senna.wad.client" ||
    definition.archiveIndexSha256 !==
      "4a7b99a471c7d0fdd3e85c0b945629e883054ebdf4652c11d117dcfd4178a03c" ||
    definition.source.sha256 !==
      "f69be19117da5bc8fb60acef2a4ec0b13453293547f6423cc67908b55898bf86" ||
    definition.source.particleName !== "Senna_Skin16_W_hit_impact" ||
    definition.definition.pathHash !== "7029e6f5"
  )
    return false;
  const emitter = definition.definition.fields["868eb76a"].elements[10].fields;
  if (emitter["3d25b8ce"].value !== "BigLensFlare1") return false;
  const originalTexture = emitter["3c6468f4"].value.toLowerCase();
  const media = definition.media.find(
    ({ reference }) => reference === originalTexture,
  );
  return (
    media?.status === "owner-archive" &&
    media.sha256 ===
      "348059cc0fc064f319fab079db2daa34732d1389d3dee40ac1c1a6ccf6cb7a9d"
  );
}

export function compileRecordedSennaFlare({
  events,
  stops,
  bindings,
  definitions,
  durationSeconds,
}) {
  assert.ok(Number.isFinite(durationSeconds) && durationSeconds > 0);
  const owners = new Map(
    bindings
      .filter(({ champion }) => champion === "Senna")
      .map(({ context, skinId }) => [
        context,
        `senna-${skinId}:${sennaWKeyHex}`,
      ]),
  );
  const admittedDefinitions = new Set(
    [...new Set(owners.values())].filter((key) =>
      isExactFlareDefinition(definitions[key]),
    ),
  );
  const handleCounts = new Map();
  for (const { handle } of events)
    handleCounts.set(handle, (handleCounts.get(handle) ?? 0) + 1);
  const stopsByHandle = new Map();
  for (const stop of stops) {
    const rows = stopsByHandle.get(stop.target);
    if (rows) rows.push(stop);
    else stopsByHandle.set(stop.target, [stop]);
  }

  const effects = [];
  const omitted = { source: 0, placement: 0, lifecycle: 0 };
  const candidates = events.filter(
    ({ owner, resourceKey }) => owners.has(owner) && resourceKey === sennaWKey,
  );
  for (const event of candidates) {
    if (
      event.resolution !== "vfx" ||
      event.definitionKey !== owners.get(event.owner) ||
      !admittedDefinitions.has(event.definitionKey)
    ) {
      omitted.source++;
      continue;
    }
    if (!isSupportedPlacement(event)) {
      omitted.placement++;
      continue;
    }
    const { handle, stamp, sequence, descriptor } = event;
    const end = stamp + sennaWLength;
    const interrupted = stopsByHandle
      .get(handle)
      ?.some((stop) => stop.sequence > sequence && stop.stamp < end);
    // Stop requests prove targeting. The native stop side effects for this
    // emitter are still unverified, so only retain complete birth envelopes.
    if (
      handleCounts.get(handle) !== 1 ||
      end > durationSeconds ||
      interrupted
    ) {
      omitted.lifecycle++;
      continue;
    }
    effects.push({
      handle,
      start: stamp,
      position: descriptor.positions[0],
      family: sennaWFlareFamily,
    });
  }
  effects.sort(
    (left, right) => left.start - right.start || left.handle - right.handle,
  );
  return { effects, candidates: candidates.length, omitted };
}
