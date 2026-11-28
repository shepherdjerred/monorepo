import { z } from "zod";
import { evaluateRecordedBillboard } from "./recorded-terrain-billboard.mjs";

const png = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.png$/);
const glsl = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.glsl$/);
const r8 = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.r8$/);
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
    .max(57344)
    .regex(/^[a-f0-9]+$/),
  indices: z
    .string()
    .min(12)
    .max(12288)
    .regex(/^[a-f0-9]+$/),
});
const worldPath = z.strictObject({
  handle: particleEffect.shape.handle,
  start: z.number().nonnegative(),
  end: z.number().positive(),
  samples: z.array(worldFrame).min(1).max(960),
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
          .max(960),
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
  worldImpact: worldQuadTrack.extend({
    paths: worldQuadTrack.shape.paths.length(2),
  }),
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
  const bytes = decodeHex(value);
  if (value.length % 56 !== 0)
    throw new Error("A recorded particle vertex layout is misaligned.");
  const view = new DataView(bytes.buffer);
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
  return bytes;
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
        const count = vertices.length / 28;
        const quadCount = count / 4;
        if (
          ("worldMaskedQuad" in style || "worldUnmaskedQuad" in style) &&
          (!Number.isInteger(quadCount) || indices.length !== quadCount * 12)
        )
          throw new Error(
            "A recorded world quad needs complete indexed quads.",
          );
        const view = new DataView(indices.buffer);
        for (let offset = 0; offset < indices.length; offset += 2)
          if (view.getUint16(offset, true) >= count)
            throw new Error(
              "A recorded world particle index is outside its vertex data.",
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
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", unpacked),
  );
  signal.throwIfAborted();
  const actual = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
  const impactTracks =
    track.schema === 8
      ? [track.worldImpact, ...(track.additionalWorldImpacts ?? [])]
      : [];
  const impactsAt = impactTracks.map((impact) => {
    palettePaths.add(impact.palette);
    basePaths.add(impact.texture);
    return compileWorldPaths(impact.paths, duration, {
      texture: impact.texture,
      palette: impact.palette,
      blend: "src-alpha-one" as const,
      alphaTest: true,
      depthTest: true,
      worldUnmaskedQuad: true as const,
      mayhemImpactComparison: true as const,
    });
  });
  const expectedTextures = new Set([...palettePaths, ...basePaths]);
  if (
    (track.schema === 1 && expectedTextures.size !== 3) ||
    expectedTextures.size !== track.textures.files.length ||
    new Set(track.textures.files).size !== expectedTextures.size ||
    !track.textures.files.every((path) => expectedTextures.has(path))
  )
    throw new Error("The recorded particle textures disagree with the track.");

  const compiledFamilies = new Map(
    track.families.map(({ id, components: entries }) => [
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
  const maximumDuration = Math.max(...lifetimes.values());
  function sampleAt(timeSeconds: number) {
    const legacyParticles = [];
    let first = 0;
    let end = track.effects.length;
    while (first < end) {
      const middle = first + Math.floor((end - first) / 2);
      if (timeSeconds - track.effects[middle]!.start >= maximumDuration)
        first = middle + 1;
      else end = middle;
    }
    for (let index = first; index < track.effects.length; index++) {
      const { start, position, family } = track.effects[index]!;
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
    shader(track.shaders.vertex),
    shader(track.shaders.fragment),
    noAlphaTestFragment === undefined ? undefined : shader(noAlphaTestFragment),
    maskedQuad === undefined ? undefined : maskedAssets(maskedQuad),
  ]);
  const images = new Map<string, ImageBitmap>();
  const closeImages = () => {
    for (const image of images.values()) image.close();
    images.clear();
  };
  try {
    for (const path of expectedTextures) {
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
      sampleAt,
      closeImages,
    };
  } catch (error) {
    closeImages();
    throw error;
  }
}

export type LoadedTerrainParticles = Awaited<
  ReturnType<typeof loadRecordedTerrainParticles>
>;
