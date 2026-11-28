import { z } from "zod";
import { evaluateRecordedBillboard } from "./recorded-terrain-billboard.mjs";
import {
  riftBillboardSources,
  riftGroundGlowSource,
  type RiftBillboardSource,
} from "./scout-rift-billboard-sources.ts";
import type { RiftCombatVisualEntry } from "./scout-rift-combat-audio.ts";
import type { RiftRibbonTrack } from "./scout-rift-projectile-trails.ts";

const png = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.png$/);
const glsl = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.glsl$/);
const r8 = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.r8$/);
const geometryPath = /^recorded-particles\/([a-f0-9]{64})\.bin$/u;
const maxPackedImpactPaths = 4096;
const maxWorldSamples = 960;
const maxWorldVertexBytes = 28672;
const maxWorldIndexBytes = 6144;
const quadComponent = z.object({
  texture: png,
  indices: z.literal("000001000200000002000300"),
  lifetime: z.number().positive(),
  samples: z
    .array(
      z.object({
        age: z.number().nonnegative(),
        vertices: z.string().regex(/^[a-f0-9]{224}$/),
      }),
    )
    .min(1)
    .max(100),
});
const component = (lifetime: number) =>
  quadComponent.extend({
    lifetime: z.literal(Math.fround(lifetime)),
  });
const material = z.enum(["one-one", "src-alpha-one"]);
const unitFloat = z.number().min(0).max(1).transform(Math.fround);
const scaleFloat = z.number().min(0).max(4096).transform(Math.fround);
const scalePair = z.tuple([scaleFloat, scaleFloat]);
const colorVector = z.tuple([unitFloat, unitFloat, unitFloat, unitFloat]);
const billboardCurve = <Value extends z.ZodType>(value: Value) =>
  z
    .array(z.tuple([unitFloat, value]))
    .min(1)
    .max(32)
    .refine(
      (keys) =>
        keys[0]?.[0] === 0 &&
        keys.every(
          ([time], index) => index === 0 || time > keys[index - 1]![0],
        ),
      "Billboard curve keys must begin at zero and increase.",
    );
const billboardProgram = z.strictObject({
  birthScale: scalePair,
  birthColor: colorVector,
  scale: billboardCurve(scalePair),
  color: billboardCurve(colorVector),
});
const familyComponent = quadComponent.extend({
  palette: png,
  blend: material,
  centerY: z.number(),
  billboard: billboardProgram.optional(),
});
const programComponent = familyComponent.extend({ alphaTest: z.boolean() });
const depthComponent = programComponent.extend({ depthTest: z.boolean() });
const familyId = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const family = z.object({
  id: familyId,
  components: z.array(familyComponent).min(1),
});
const particleEffect = z.object({
  handle: z.number().int().positive().max(0xffff_ffff),
  start: z.number().nonnegative(),
  position: z.tuple([z.number(), z.number(), z.number()]),
});
const trackIdentity = z.object({
  kind: z.literal("recorded-native-terrain-particles"),
  build: z.literal("16.23.841.8428"),
  replaySha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("verified-partial-effects"),
  scope: z.literal("native-sampled-cold-remap"),
  shaders: z.object({ vertex: glsl, fragment: glsl }),
});
const singleFamilyTrack = trackIdentity.extend({
  schema: z.literal(1),
  effects: z.array(particleEffect).min(1),
  components: z.tuple([component(0.2), component(0.3)]),
  textures: z.object({ palette: png, files: z.array(png).length(3) }),
});
const familyTrack = trackIdentity.extend({
  schema: z.literal(2),
  effects: z.array(particleEffect.extend({ family: familyId })).min(1),
  families: z.array(family).min(1),
  textures: z.object({ files: z.array(png).min(1) }),
});
const multipleProgramsTrack = familyTrack.extend({
  schema: z.literal(3),
  families: z
    .array(
      family.extend({
        components: z.array(programComponent).min(1),
      }),
    )
    .min(1),
  shaders: trackIdentity.shape.shaders.extend({ noAlphaTestFragment: glsl }),
});
const worldFrame = z.strictObject({
  age: z.number().positive(),
  vertices: z
    .string()
    .min(168)
    .max(maxWorldVertexBytes * 2)
    .regex(/^[a-f0-9]+$/),
  indices: z
    .string()
    .min(12)
    .max(maxWorldIndexBytes * 2)
    .regex(/^[a-f0-9]+$/),
});
const worldPath = z.strictObject({
  handle: particleEffect.shape.handle,
  start: z.number().nonnegative(),
  end: z.number().positive(),
  samples: z.array(worldFrame).min(1).max(maxWorldSamples),
});
const worldTrack = z.strictObject({
  texture: png,
  palette: png,
  paths: z.array(worldPath).min(1).max(256),
});
const worldQuadTrack = worldTrack.extend({
  paths: z
    .array(
      worldPath.extend({
        samples: z
          .array(worldFrame.extend({ age: z.number().nonnegative() }))
          .min(1)
          .max(maxWorldSamples),
      }),
    )
    .min(1)
    .max(256),
});
const indexedRibbonTrack = multipleProgramsTrack.extend({
  schema: z.literal(4),
  worldRibbon: worldTrack,
});
const depthStateTrack = indexedRibbonTrack.extend({
  schema: z.literal(5),
  families: z
    .array(
      family.extend({
        components: z.array(depthComponent).min(1),
      }),
    )
    .min(1),
});
const dimension = z.number().int().min(1).max(4096);
const worldCoordinate = z
  .number()
  .refine((lane) => Number.isFinite(Math.fround(lane)));
const worldScale = worldCoordinate.refine((lane) => Math.fround(lane) > 0);
const maskedWorldTrack = depthStateTrack.extend({
  schema: z.literal(6),
  worldUnmaskedQuad: worldQuadTrack
    .extend({ depthTest: z.literal(false) })
    .optional(),
  worldMaskedQuad: worldQuadTrack.extend({
    vertexShader: glsl,
    fragmentShader: glsl,
    mask: z.strictObject({ path: r8, width: dimension, height: dimension }),
    worldToUv: z.tuple([
      worldScale,
      worldScale,
      worldCoordinate,
      worldCoordinate,
    ]),
  }),
});
const billboardDepthTrack = familyTrack.extend({
  schema: z.literal(7),
  families: z
    .array(family.extend({ components: z.array(depthComponent).min(1) }))
    .min(1),
  shaders: trackIdentity.shape.shaders.extend({
    noAlphaTestFragment: glsl.optional(),
  }),
});
const mayhemLocalQuad = (lifetime: number) =>
  depthComponent.extend({
    lifetime: z.literal(Math.fround(lifetime)),
    blend: z.literal("one-one"),
    alphaTest: z.literal(true),
    depthTest: z.literal(true),
  });
const mayhemImpactComparisonTrack = familyTrack.extend({
  schema: z.literal(8),
  status: z.literal("controlled-mayhem-impact-comparison"),
  scope: z.literal("native-sampled-supplied-random"),
  effects: z.array(
    particleEffect.extend({
      family: z.enum(["heimerdinger-w-impact", "heimerdinger-q-ammo-spend"]),
    }),
  ),
  families: z
    .array(
      z.discriminatedUnion("id", [
        family.extend({
          id: z.literal("heimerdinger-w-impact"),
          components: z.tuple([mayhemLocalQuad(0.2), mayhemLocalQuad(0.3)]),
        }),
        family.extend({
          id: z.literal("heimerdinger-q-ammo-spend"),
          components: z.tuple([mayhemLocalQuad(0.5)]),
        }),
      ]),
    )
    .max(2),
  worldImpact: worldQuadTrack
    .extend({ paths: worldQuadTrack.shape.paths.length(2) })
    .optional(),
  packedWorldImpacts: z
    .array(
      z.strictObject({
        texture: png,
        palette: png,
        path: z.string().regex(geometryPath),
        bytes: z
          .number()
          .int()
          .min(1)
          .max(16 * 1024 * 1024),
      }),
    )
    .length(1)
    .optional(),
  additionalWorldImpacts: z.array(worldQuadTrack).max(8).optional(),
});
const particleTrack = z.discriminatedUnion("schema", [
  singleFamilyTrack,
  familyTrack,
  multipleProgramsTrack,
  indexedRibbonTrack,
  depthStateTrack,
  maskedWorldTrack,
  billboardDepthTrack,
  mayhemImpactComparisonTrack,
]);

type RiftBillboardFamilyId = keyof typeof riftBillboardSources;
const riftBillboardResource = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("recorded-rift-billboard-resources"),
  build: trackIdentity.shape.build,
  mapId: z.literal(11),
  families: z
    .array(
      z.strictObject({
        id: z.custom<RiftBillboardFamilyId>(
          (value) =>
            typeof value === "string" &&
            Object.hasOwn(riftBillboardSources, value),
        ),
        components: z.array(depthComponent.strict()).min(1).max(4),
      }),
    )
    .length(Object.keys(riftBillboardSources).length),
  textures: z.strictObject({ files: z.array(png).min(1).max(20) }),
  shaders: billboardDepthTrack.shape.shaders.strict(),
});
const riftWorldQuadResource = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("recorded-rift-world-quad-resources"),
  build: trackIdentity.shape.build,
  mapId: z.literal(11),
  family: z.strictObject({
    id: z.literal("maokai-e-ground-glow"),
    components: z.tuple([
      depthComponent.strict().extend({
        placement: z.literal("world"),
        centerY: z.literal(0),
        blend: z.literal("src-alpha-one"),
        alphaTest: z.literal(false),
        depthTest: z.literal(false),
        billboard: z.never().optional(),
      }),
    ]),
  }),
  shaders: trackIdentity.shape.shaders
    .extend({ noAlphaTestFragment: glsl })
    .strict(),
});

function normalizeTrack(track: z.infer<typeof particleTrack>) {
  if (track.schema !== 1) return track;
  const family = "heimerdinger-w-impact";
  return {
    ...track,
    effects: track.effects.map((effect) => ({ ...effect, family })),
    families: [
      {
        id: family,
        components: track.components.map((entry) => ({
          ...entry,
          palette: track.textures.palette,
          blend: "one-one" as const,
          centerY: 100,
        })),
      },
    ],
  };
}

function decodeHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(value.slice(2 * index, 2 * index + 2), 16);
  return bytes;
}

function decodeVertices(value: string, localPlane: boolean) {
  if (value.length % 56 !== 0)
    throw new Error("A recorded particle vertex layout is misaligned.");
  const bytes = decodeHex(value);
  validateVertices(bytes, localPlane);
  return bytes;
}

function validateVertices(bytes: Uint8Array, localPlane: boolean) {
  if (bytes.length % 28 !== 0)
    throw new Error("A recorded particle vertex layout is misaligned.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < view.byteLength; offset += 28) {
    if (
      [0, 4, 8].some(
        (lane) => !Number.isFinite(view.getFloat32(offset + lane, true)),
      ) ||
      [16, 18, 20, 22, 24, 26].some(
        (lane) => (view.getUint16(offset + lane, true) & 0x7c00) === 0x7c00,
      )
    )
      throw new Error("A recorded particle vertex has a nonfinite lane.");
    if (localPlane && view.getFloat32(offset + 8, true) !== 0)
      throw new Error(
        "A recorded particle quad is outside its local XY plane.",
      );
  }
}

function compileWorldPaths<Style extends object>(
  paths: readonly z.infer<typeof worldPath>[],
  duration: number,
  style: Style,
) {
  if (new Set(paths.map(({ handle }) => handle)).size !== paths.length)
    throw new Error("A recorded world particle repeats an effect handle.");
  const compiled = paths.map(({ start, end, samples }) => {
    if (start >= end || end > duration)
      throw new Error(
        "A recorded world particle interval is outside the replay.",
      );
    let previous = -1;
    const frames = samples.map(
      ({ age, vertices: packed, indices: rawIndices }) => {
        if (
          age <= previous ||
          age >= end - start ||
          rawIndices.length % 12 !== 0
        )
          throw new Error(
            "A recorded world particle sample has an invalid time or index layout.",
          );
        previous = age;
        const vertices = decodeVertices(packed, false);
        const indices = decodeHex(rawIndices);
        validateWorldIndices(
          vertices,
          indices,
          "worldMaskedQuad" in style || "worldUnmaskedQuad" in style,
        );
        return { age, vertices, indices };
      },
    );
    return { start, end, frames };
  });
  return (time: number) =>
    compiled.flatMap(({ start, end, frames }) => {
      if (time < start || time >= end) return [];
      const frame = frames.findLast(({ age }) => age <= time - start);
      return frame === undefined ? [] : [{ ...style, ...frame }];
    });
}

function validateWorldIndices(
  vertices: Uint8Array,
  indices: Uint8Array,
  quads: boolean,
) {
  const count = vertices.length / 28;
  const quadCount = count / 4;
  if (
    quads &&
    (!Number.isInteger(quadCount) || indices.length !== quadCount * 12)
  )
    throw new Error("A recorded world quad needs complete indexed quads.");
  const view = new DataView(
    indices.buffer,
    indices.byteOffset,
    indices.byteLength,
  );
  for (let offset = 0; offset < indices.length; offset += 2)
    if (view.getUint16(offset, true) >= count)
      throw new Error(
        "A recorded world particle index is outside its vertex data.",
      );
}

type PackedWorldImpact = NonNullable<
  z.infer<typeof mayhemImpactComparisonTrack>["packedWorldImpacts"]
>[number];

function firstMatchingIndex<T>(
  entries: readonly T[],
  matches: (entry: T) => boolean,
) {
  let first = 0;
  let end = entries.length;
  while (first < end) {
    const middle = first + Math.floor((end - first) / 2);
    if (matches(entries[middle]!)) end = middle;
    else first = middle + 1;
  }
  return first;
}

async function compilePackedWorldImpact<Style extends object>(
  packed: PackedWorldImpact,
  read: (path: string) => Promise<ArrayBuffer>,
  duration: number,
  handles: Set<number>,
  style: Style,
  signal: AbortSignal,
) {
  const geometry = await read(`/${packed.path}`);
  signal.throwIfAborted();
  if (geometry.byteLength !== packed.bytes)
    throw new Error("Recorded world impact geometry has an unexpected size.");
  const actual = await sha256Hex(geometry);
  signal.throwIfAborted();
  if (actual !== geometryPath.exec(packed.path)![1])
    throw new Error("Recorded world impact geometry digest differs.");

  const view = new DataView(geometry);
  let offset = 0;
  function consume(bytes: number) {
    const start = offset;
    if (bytes > view.byteLength - start)
      throw new Error("Recorded world impact geometry ended early.");
    offset += bytes;
    return start;
  }
  const paths = view.getUint32(consume(4), true);
  if (paths === 0 || paths > maxPackedImpactPaths)
    throw new Error("Recorded world impact has an invalid placement count.");
  let previousStart = -1;
  let latestEnd = 0;
  const compiled = Array.from({ length: paths }, () => {
    const handle = view.getUint32(consume(4), true);
    const start = view.getFloat64(consume(8), true);
    const end = view.getFloat64(consume(8), true);
    const count = view.getUint32(consume(4), true);
    if (
      handle === 0 ||
      handles.has(handle) ||
      !(
        start >= 0 &&
        start >= previousStart &&
        end > start &&
        end <= duration
      ) ||
      count === 0 ||
      count > maxWorldSamples
    )
      throw new Error("Recorded world impact has an invalid placement.");
    handles.add(handle);
    previousStart = start;
    latestEnd = Math.max(latestEnd, end);
    let previousAge = -1;
    const frames = Array.from({ length: count }, () => {
      const age = view.getFloat64(consume(8), true);
      const vertexBytes = view.getUint16(consume(2), true);
      const indexBytes = view.getUint16(consume(2), true);
      if (
        !(age >= 0 && age > previousAge && age < end - start) ||
        vertexBytes < 112 ||
        vertexBytes > maxWorldVertexBytes ||
        indexBytes < 12 ||
        indexBytes > maxWorldIndexBytes
      )
        throw new Error("Recorded world impact has an invalid sample.");
      previousAge = age;
      const vertices = new Uint8Array(
        geometry,
        consume(vertexBytes),
        vertexBytes,
      );
      const indices = new Uint8Array(geometry, consume(indexBytes), indexBytes);
      validateVertices(vertices, false);
      validateWorldIndices(vertices, indices, true);
      return { age, vertices, indices };
    });
    return { start, end, latestEnd, frames };
  });
  if (offset !== view.byteLength)
    throw new Error("Recorded world impact geometry has trailing bytes.");

  return (time: number) => {
    const active = [];
    const first = firstMatchingIndex(compiled, (path) => path.latestEnd > time);
    for (let index = first; index < compiled.length; index++) {
      const { start, end, frames } = compiled[index]!;
      if (time < start) break;
      if (time >= end) continue;
      const frame =
        frames[
          firstMatchingIndex(frames, (sample) => sample.age > time - start) - 1
        ];
      if (frame !== undefined) active.push({ ...style, ...frame });
    }
    return active;
  };
}

async function sha256Hex(bytes: BufferSource) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const gzipTrackEnvelope = z.strictObject({
  kind: z.literal("gzip-recorded-native-terrain-particles"),
  schema: z.literal(1),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(64 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export async function readRecordedParticleTrackJson(
  read: (path: string) => Promise<ArrayBuffer>,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const bytes = await read("/recorded-particles.json");
  signal.throwIfAborted();
  const track: unknown = JSON.parse(decoder.decode(bytes));
  if (
    track === null ||
    typeof track !== "object" ||
    !("kind" in track) ||
    track.kind !== "gzip-recorded-native-terrain-particles"
  )
    return track;

  const { bytes: decodedSize, sha256 } = gzipTrackEnvelope.parse(track);
  const gzip = await read("/recorded-particles.json.gz");
  signal.throwIfAborted();
  const unpacked = new Uint8Array(decodedSize);
  const reader = new Blob([gzip])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"), { signal })
    .getReader();
  let offset = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      if (chunk.value.length > decodedSize - offset)
        throw new Error("Recorded particle track exceeded its decoded size");
      unpacked.set(chunk.value, offset);
      offset += chunk.value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (offset !== decodedSize)
    throw new Error("Recorded particle track has an unexpected decoded size");
  const actual = await sha256Hex(unpacked);
  signal.throwIfAborted();
  if (actual !== sha256)
    throw new Error("Recorded particle track decoded digest differs");
  return JSON.parse(decoder.decode(unpacked));
}

export async function loadRecordedTerrainParticles(
  read: (path: string) => Promise<ArrayBuffer>,
  identity: {
    build: string;
    replaySha256: string;
    durationMilliseconds: number;
    mayhemImpactComparison?: boolean;
  },
  signal: AbortSignal,
) {
  const track = normalizeTrack(
    particleTrack.parse(await readRecordedParticleTrackJson(read, signal)),
  );
  if ((track.schema === 8) !== (identity.mayhemImpactComparison === true))
    throw new Error(
      "The recorded impact comparison capability disagrees with this package.",
    );
  const lifetimes = new Map(
    track.families.map(({ id, components }) => [
      id,
      Math.max(...components.map(({ lifetime }) => lifetime)),
    ]),
  );
  const activeFamilies = new Set(track.effects.map(({ family }) => family));
  if (
    identity.build !== track.build ||
    identity.replaySha256 !== track.replaySha256 ||
    lifetimes.size !== track.families.length ||
    activeFamilies.size !== lifetimes.size ||
    new Set(track.effects.map(({ handle }) => handle)).size !==
      track.effects.length ||
    track.effects.some(({ start, position, family }, index) => {
      const lifetime = lifetimes.get(family);
      return (
        lifetime === undefined ||
        start + lifetime > identity.durationMilliseconds / 1000 ||
        (index > 0 && start < track.effects[index - 1]!.start) ||
        position.some((value) => !Number.isFinite(Math.fround(value)))
      );
    })
  )
    throw new Error("The recorded particle track disagrees with this replay.");
  const components = track.families.flatMap((family) => family.components);
  const unmaskedQuad = track.schema === 6 ? track.worldUnmaskedQuad : undefined;
  const noAlphaTestFragment =
    "noAlphaTestFragment" in track.shaders
      ? track.shaders.noAlphaTestFragment
      : undefined;
  const needsNoAlphaTest =
    unmaskedQuad !== undefined ||
    components.some((entry) => "alphaTest" in entry && !entry.alphaTest);
  if (
    (noAlphaTestFragment !== undefined) !== needsNoAlphaTest ||
    track.shaders.fragment === noAlphaTestFragment
  )
    throw new Error(
      "The recorded particle track lacks a distinct untested-alpha program.",
    );
  const palettePaths = new Set(components.map(({ palette }) => palette));
  const basePaths = new Set(components.map(({ texture }) => texture));
  const duration = identity.durationMilliseconds / 1000;
  const worldRibbonAt =
    "worldRibbon" in track
      ? compileWorldPaths(track.worldRibbon.paths, duration, {
          texture: track.worldRibbon.texture,
          palette: track.worldRibbon.palette,
          blend: "src-alpha-one" as const,
          alphaTest: true,
          depthTest: true,
          worldRibbon: true as const,
        })
      : undefined;
  if ("worldRibbon" in track) {
    palettePaths.add(track.worldRibbon.palette);
    basePaths.add(track.worldRibbon.texture);
  }
  const maskedQuad = track.schema === 6 ? track.worldMaskedQuad : undefined;
  const maskedQuadAt =
    maskedQuad === undefined
      ? undefined
      : compileWorldPaths(maskedQuad.paths, duration, {
          texture: maskedQuad.texture,
          palette: maskedQuad.palette,
          blend: "src-alpha-one" as const,
          alphaTest: false,
          depthTest: false,
          worldMaskedQuad: true as const,
        });
  if (maskedQuad !== undefined) {
    palettePaths.add(maskedQuad.palette);
    basePaths.add(maskedQuad.texture);
  }
  const unmaskedQuadAt =
    unmaskedQuad === undefined
      ? undefined
      : compileWorldPaths(unmaskedQuad.paths, duration, {
          texture: unmaskedQuad.texture,
          palette: unmaskedQuad.palette,
          blend: "src-alpha-one" as const,
          alphaTest: false,
          depthTest: unmaskedQuad.depthTest,
          worldUnmaskedQuad: true as const,
        });
  if (unmaskedQuad !== undefined) {
    palettePaths.add(unmaskedQuad.palette);
    basePaths.add(unmaskedQuad.texture);
  }
  const impactStyle = {
    blend: "src-alpha-one",
    alphaTest: true,
    depthTest: true,
    worldUnmaskedQuad: true,
    mayhemImpactComparison: true,
  } as const;
  const impactTracks =
    track.schema === 8 ? [...(track.additionalWorldImpacts ?? [])] : [];
  const packedImpact =
    track.schema === 8 ? track.packedWorldImpacts?.[0] : undefined;
  if (track.schema === 8) {
    if ((track.worldImpact === undefined) === (packedImpact === undefined))
      throw new Error(
        "The recorded impact comparison needs one primary impact track.",
      );
    if (track.worldImpact !== undefined)
      impactTracks.unshift(track.worldImpact);
  }
  const impactsAt = impactTracks.map((impact) => {
    palettePaths.add(impact.palette);
    basePaths.add(impact.texture);
    return compileWorldPaths(impact.paths, duration, {
      ...impactStyle,
      texture: impact.texture,
      palette: impact.palette,
    });
  });
  if (packedImpact !== undefined) {
    const { texture, palette } = packedImpact;
    palettePaths.add(palette);
    basePaths.add(texture);
    const handles = new Set(track.effects.map(({ handle }) => handle));
    for (const impact of impactTracks)
      for (const { handle } of impact.paths) handles.add(handle);
    impactsAt.unshift(
      await compilePackedWorldImpact(
        packedImpact,
        read,
        duration,
        handles,
        { ...impactStyle, texture, palette },
        signal,
      ),
    );
  }
  const expectedTextures = new Set([...palettePaths, ...basePaths]);
  if (
    (track.schema === 1 && expectedTextures.size !== 3) ||
    expectedTextures.size !== track.textures.files.length ||
    new Set(track.textures.files).size !== expectedTextures.size ||
    !track.textures.files.every((path) => expectedTextures.has(path))
  )
    throw new Error("The recorded particle textures disagree with the track.");

  const sampleLocalAt = compileLocalParticleSampler(
    track.families,
    track.effects,
  );
  function sampleAt(timeSeconds: number) {
    const legacyParticles = sampleLocalAt(timeSeconds);
    if (impactsAt.length > 0)
      return [
        ...impactsAt.flatMap((read) => read(timeSeconds)),
        ...legacyParticles,
      ];
    const particles =
      worldRibbonAt === undefined
        ? legacyParticles
        : [...worldRibbonAt(timeSeconds), ...legacyParticles];
    const withMask =
      maskedQuadAt === undefined
        ? particles
        : [...particles, ...maskedQuadAt(timeSeconds)];
    return unmaskedQuadAt === undefined
      ? withMask
      : [...withMask, ...unmaskedQuadAt(timeSeconds)];
  }

  const assets = await loadTerrainParticleAssets(
    read,
    signal,
    track.shaders,
    palettePaths,
    basePaths,
    noAlphaTestFragment,
    maskedQuad,
  );
  return { ...assets, sampleAt };
}

function compileLocalParticleFamilies(
  families: ReturnType<typeof normalizeTrack>["families"],
) {
  return new Map(
    families.map(({ id, components: entries }) => [
      id,
      entries.map((component) => {
        const { indices, samples, ...entry } = component;
        const billboard =
          "billboard" in component ? component.billboard : undefined;
        if (
          !Number.isFinite(Math.fround(entry.centerY)) ||
          samples.some(
            ({ age }, index) =>
              age >= entry.lifetime ||
              (index > 0 && age <= samples[index - 1]!.age),
          )
        )
          throw new Error("The recorded particle component is invalid.");
        const nativeSamples = samples.map(({ age, vertices }) => ({
          age,
          vertices: decodeVertices(vertices, true),
        }));
        const program =
          billboard === undefined
            ? undefined
            : {
                centerY: Math.fround(entry.centerY),
                lifetime: Math.fround(entry.lifetime),
                blend: entry.blend,
                billboard,
              };
        if (
          program !== undefined &&
          (nativeSamples.length < 3 ||
            nativeSamples.some(({ age, vertices }) =>
              evaluateRecordedBillboard(program, age).some(
                (byte, index) => byte !== vertices[index],
              ),
            ))
        )
          throw new Error(
            "The billboard program disagrees with native vertices.",
          );
        const firstLiveAge = Math.fround(nativeSamples[0]!.age);
        return {
          texture: entry.texture,
          palette: entry.palette,
          blend: entry.blend,
          centerY: entry.centerY,
          lifetime: entry.lifetime,
          alphaTest: "alphaTest" in entry ? entry.alphaTest : true,
          depthTest: "depthTest" in entry ? entry.depthTest : true,
          indices: decodeHex(indices),
          verticesAt:
            program === undefined
              ? (age: number) =>
                  nativeSamples.findLast((sample) => sample.age <= age)
                    ?.vertices
              : (age: number) =>
                  Math.fround(age) < firstLiveAge ||
                  Math.fround(age) >= program.lifetime
                    ? undefined
                    : evaluateRecordedBillboard(program, age),
        };
      }),
    ]),
  );
}

function compileLocalParticleSampler(
  families: ReturnType<typeof normalizeTrack>["families"],
  effects: readonly (z.infer<typeof particleEffect> & { family: string })[],
) {
  const compiledFamilies = compileLocalParticleFamilies(families);
  const maximumDuration = Math.max(
    ...[...compiledFamilies.values()].flatMap((entries) =>
      entries.map(({ lifetime }) => lifetime),
    ),
  );
  return (timeSeconds: number) => {
    const legacyParticles = [];
    let first = 0;
    let end = effects.length;
    while (first < end) {
      const middle = first + Math.floor((end - first) / 2);
      if (timeSeconds - effects[middle]!.start >= maximumDuration)
        first = middle + 1;
      else end = middle;
    }
    for (let index = first; index < effects.length; index++) {
      const { start, position, family } = effects[index]!;
      const age = timeSeconds - start;
      if (age < 0) break;
      for (const { lifetime, verticesAt, ...style } of compiledFamilies.get(
        family,
      )!) {
        if (age >= lifetime) continue;
        const vertices = verticesAt(age);
        if (vertices !== undefined)
          legacyParticles.push({
            ...style,
            position,
            vertices,
          });
      }
    }
    return legacyParticles;
  };
}

async function loadTerrainParticleAssets(
  read: (path: string) => Promise<ArrayBuffer>,
  signal: AbortSignal,
  shaders: { vertex: string; fragment: string },
  palettePaths: ReadonlySet<string>,
  basePaths: ReadonlySet<string>,
  noAlphaTestFragment?: string,
  maskedQuad?: z.infer<typeof maskedWorldTrack>["worldMaskedQuad"],
) {
  const shaderDecoder = new TextDecoder("utf-8", { fatal: true });
  const shader = async (path: string) =>
    shaderDecoder.decode(await read(`/${path}`));
  const maskedAssets = async (quad: NonNullable<typeof maskedQuad>) => {
    const { path, width, height } = quad.mask;
    const bytes = await read(`/${path}`);
    if (bytes.byteLength !== width * height)
      throw new Error(
        "The recorded particle mask does not match its dimensions.",
      );
    const [vertexShader, fragmentShader] = await Promise.all([
      shader(quad.vertexShader),
      shader(quad.fragmentShader),
    ]);
    return {
      vertexShader,
      fragmentShader,
      mask: new Uint8Array(bytes),
      width,
      height,
      worldToUv: quad.worldToUv,
    };
  };
  const [
    vertexShader,
    fragmentShader,
    noAlphaTestFragmentShader,
    worldMaskedQuad,
  ] = await Promise.all([
    shader(shaders.vertex),
    shader(shaders.fragment),
    noAlphaTestFragment === undefined ? undefined : shader(noAlphaTestFragment),
    maskedQuad === undefined ? undefined : maskedAssets(maskedQuad),
  ]);
  const images = new Map<string, ImageBitmap>();
  const closeImages = () => {
    for (const image of images.values()) image.close();
    images.clear();
  };
  try {
    for (const path of new Set([...palettePaths, ...basePaths])) {
      signal.throwIfAborted();
      const image = await createImageBitmap(
        new Blob([await read(`/${path}`)], { type: "image/png" }),
        { colorSpaceConversion: "none", premultiplyAlpha: "none" },
      );
      images.set(path, image);
    }
    signal.throwIfAborted();
    const fromPaths = (paths: ReadonlySet<string>) =>
      new Map(Array.from(paths, (path) => [path, images.get(path)!]));
    return {
      assets: {
        vertexShader,
        fragmentShader,
        noAlphaTestFragmentShader,
        worldMaskedQuad,
        palettes: fromPaths(palettePaths),
        baseTextures: fromPaths(basePaths),
      },
      closeImages,
    };
  } catch (error) {
    closeImages();
    throw error;
  }
}

function isExactFloat32(value: number) {
  return Number.isFinite(value) && Math.fround(value) === value;
}

function hasReviewedBillboardPlacement(
  entry: RiftCombatVisualEntry,
  source: RiftBillboardSource,
  lifetime: number,
  durationSeconds: number,
) {
  const {
    positions: [origin, secondary, unused],
    scaleRate,
    timeSeconds,
    sequence,
  } = entry;
  return (
    entry.handleCount === 1 &&
    scaleRate[0] === source.scale &&
    scaleRate[1] === 1 &&
    origin.every(isExactFloat32) &&
    secondary.every(
      (axis, index) => axis === (source.repeatOrigin ? origin[index] : 0),
    ) &&
    unused.every((axis) => axis === 0) &&
    timeSeconds + lifetime <= durationSeconds &&
    // Only natural expiration is covered by the reviewed emitter samples.
    !entry.stops.some(
      (stop) =>
        stop.sequence > sequence && stop.timeSeconds < timeSeconds + lifetime,
    )
  );
}

function translateQuadVertices(
  localVertices: Uint8Array,
  origin: readonly [number, number, number],
) {
  const vertices = localVertices.slice();
  const packed = new DataView(vertices.buffer);
  for (let offset = 0; offset < vertices.byteLength; offset += 28) {
    for (const [axis, lane] of origin.entries()) {
      const address = offset + axis * 4;
      packed.setFloat32(address, packed.getFloat32(address, true) + lane, true);
    }
  }
  return vertices;
}

function compileRiftWorldQuadSampler(
  { family }: z.infer<typeof riftWorldQuadResource>,
  entries: readonly RiftCombatVisualEntry[],
  durationSeconds: number,
) {
  const [{ indices, samples, lifetime, placement: _, ...style }] =
    family.components;
  if (
    samples.some(
      ({ age }, index) =>
        age >= lifetime || (index > 0 && age <= samples[index - 1]!.age),
    )
  )
    throw new Error("The Rift world quad sample clock is invalid.");
  const frames = samples.map(({ age, vertices }) => ({
    age,
    vertices: decodeVertices(vertices, false),
  }));
  const indexBytes = decodeHex(indices);
  const placements = entries.filter(
    (entry) =>
      entry.resourceKey === riftGroundGlowSource.resourceKey &&
      hasReviewedBillboardPlacement(
        entry,
        riftGroundGlowSource,
        lifetime,
        durationSeconds,
      ),
  );
  return (time: number) => {
    const active = [];
    const first = firstMatchingIndex(
      placements,
      ({ timeSeconds }) => time < timeSeconds + lifetime,
    );
    for (let index = first; index < placements.length; index++) {
      const { timeSeconds, positions } = placements[index]!;
      const age = time - timeSeconds;
      if (age < 0) break;
      const frame = frames.findLast((candidate) => candidate.age <= age);
      if (frame !== undefined)
        active.push({
          ...style,
          worldUnmaskedQuad: true as const,
          indices: indexBytes,
          vertices: translateQuadVertices(frame.vertices, positions[0]),
        });
    }
    return active;
  };
}

export async function loadRiftBillboardParticles(
  read: (path: string) => Promise<ArrayBuffer>,
  identity: { build: string; durationMilliseconds: number },
  entries: readonly RiftCombatVisualEntry[],
  signal: AbortSignal,
  worldQuads: boolean,
  ribbons?: RiftRibbonTrack,
): Promise<LoadedTerrainParticles> {
  signal.throwIfAborted();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const readJson = async (path: string): Promise<unknown> =>
    JSON.parse(decoder.decode(await read(path)));
  const [resource, world] = await Promise.all([
    readJson("/rift-billboards.json").then((json) =>
      riftBillboardResource.parse(json),
    ),
    worldQuads
      ? readJson("/rift-world-quads.json").then((json) =>
          riftWorldQuadResource.parse(json),
        )
      : undefined,
  ]);
  if (
    identity.build !== resource.build ||
    new Set(resource.families.map(({ id }) => id)).size !==
      resource.families.length
  )
    throw new Error(
      "The Rift billboard catalog disagrees with the replay build.",
    );

  const components = resource.families.flatMap((family) => family.components);
  const palettePaths = new Set(components.map(({ palette }) => palette));
  const basePaths = new Set(components.map(({ texture }) => texture));
  const expectedTextures = new Set([...palettePaths, ...basePaths]);
  const { vertex, fragment, noAlphaTestFragment } = resource.shaders;
  if (
    expectedTextures.size !== resource.textures.files.length ||
    new Set(resource.textures.files).size !== expectedTextures.size ||
    resource.textures.files.some((path) => !expectedTextures.has(path)) ||
    vertex === fragment ||
    vertex === noAlphaTestFragment ||
    fragment === noAlphaTestFragment ||
    components.some(({ alphaTest }) => !alphaTest) !==
      (noAlphaTestFragment !== undefined)
  )
    throw new Error("The Rift billboard assets disagree with the catalog.");
  const duration = identity.durationMilliseconds / 1000;
  const sampleWorldAt =
    world === undefined
      ? undefined
      : compileRiftWorldQuadSampler(world, entries, duration);
  if (ribbons !== undefined) {
    palettePaths.add(ribbons.palette);
    basePaths.add(ribbons.texture);
  }
  if (world !== undefined) {
    if (
      world.build !== resource.build ||
      world.shaders.vertex !== vertex ||
      world.shaders.fragment !== fragment ||
      world.shaders.noAlphaTestFragment !== noAlphaTestFragment
    )
      throw new Error(
        "The Rift world quad programs disagree with the catalog.",
      );
    const [{ texture, palette }] = world.family.components;
    palettePaths.add(palette);
    basePaths.add(texture);
  }

  const byResource = new Map<
    number,
    {
      id: RiftBillboardFamilyId;
      source: RiftBillboardSource;
      lifetime: number;
    }
  >(
    resource.families.map(({ id, components: familyComponents }) => {
      const source = riftBillboardSources[id];
      return [
        source.resourceKey,
        {
          id,
          source,
          lifetime: Math.max(
            ...familyComponents.map(({ lifetime }) => lifetime),
          ),
        },
      ];
    }),
  );
  const effects = [];
  for (const entry of entries) {
    const rule = byResource.get(entry.resourceKey);
    if (
      rule === undefined ||
      !hasReviewedBillboardPlacement(
        entry,
        rule.source,
        rule.lifetime,
        duration,
      )
    )
      continue;
    effects.push({
      family: rule.id,
      handle: entry.handle,
      start: entry.timeSeconds,
      position: entry.positions[0],
    });
  }
  const sampleBillboardsAt = compileLocalParticleSampler(
    resource.families,
    effects,
  );
  const assets = await loadTerrainParticleAssets(
    async (path) => {
      const data = await read(path);
      signal.throwIfAborted();
      const digest = path.slice(
        path.lastIndexOf("/") + 1,
        path.lastIndexOf("."),
      );
      if ((await sha256Hex(data)) !== digest)
        throw new Error(
          "A Rift billboard asset digest disagrees with its path.",
        );
      return data;
    },
    signal,
    resource.shaders,
    palettePaths,
    basePaths,
    noAlphaTestFragment,
  );
  return {
    ...assets,
    sampleAt: (time: number) => [
      ...(ribbons?.sampleAt(time) ?? []),
      ...sampleBillboardsAt(time),
      ...(sampleWorldAt?.(time) ?? []),
    ],
  };
}

export type LoadedTerrainParticles = Awaited<
  ReturnType<typeof loadRecordedTerrainParticles>
>;
