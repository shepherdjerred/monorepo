import { z } from "zod";

const png = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.png$/);
const glsl = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.glsl$/);
const quadComponent = z.object({
  texture: png,
  indices: z.literal("000001000200000002000300"),
  lifetime: z.number().positive(),
  samples: z
    .array(
      z.object({
        age: z.number().positive(),
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
const familyComponent = quadComponent.extend({
  palette: png,
  blend: material,
  centerY: z.number(),
});
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
        components: z
          .array(familyComponent.extend({ alphaTest: z.boolean() }))
          .min(1),
      }),
    )
    .min(1),
  shaders: trackIdentity.shape.shaders.extend({ noAlphaTestFragment: glsl }),
});
const particleTrack = z.discriminatedUnion("schema", [
  singleFamilyTrack,
  familyTrack,
  multipleProgramsTrack,
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

function decodeQuad(value: string) {
  const bytes = decodeHex(value);
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
    if (view.getFloat32(offset + 8, true) !== 0)
      throw new Error(
        "A recorded particle quad is outside its local XY plane.",
      );
  }
  return bytes;
}

export async function loadRecordedTerrainParticles(
  read: (path: string) => Promise<ArrayBuffer>,
  identity: {
    build: string;
    replaySha256: string;
    durationMilliseconds: number;
  },
  signal: AbortSignal,
) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const track = normalizeTrack(
    particleTrack.parse(
      JSON.parse(decoder.decode(await read("/recorded-particles.json"))),
    ),
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
  const noAlphaTestFragment =
    track.schema === 3 ? track.shaders.noAlphaTestFragment : undefined;
  if (
    track.schema === 3 &&
    (track.shaders.fragment === noAlphaTestFragment ||
      !track.families.some(({ components }) =>
        components.some(({ alphaTest }) => !alphaTest),
      ))
  )
    throw new Error(
      "The recorded particle track lacks a distinct untested-alpha program.",
    );
  const palettePaths = new Set(components.map(({ palette }) => palette));
  const basePaths = new Set(components.map(({ texture }) => texture));
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
      entries.map(({ indices, samples, ...entry }) => {
        if (
          !Number.isFinite(Math.fround(entry.centerY)) ||
          samples.some(
            ({ age }, index) =>
              age >= entry.lifetime ||
              (index > 0 && age <= samples[index - 1]!.age),
          )
        )
          throw new Error("The recorded particle component is invalid.");
        return {
          ...entry,
          alphaTest: "alphaTest" in entry ? entry.alphaTest : true,
          indices: decodeHex(indices),
          samples: samples.map(({ age, vertices }) => ({
            age,
            vertices: decodeQuad(vertices),
          })),
        };
      }),
    ]),
  );
  const maximumDuration = Math.max(...lifetimes.values());
  function sampleAt(timeSeconds: number) {
    const particles = [];
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
      for (const { lifetime, samples, ...style } of compiledFamilies.get(
        family,
      )!) {
        if (age >= lifetime) continue;
        const sample = samples.findLast((entry) => entry.age <= age);
        if (sample !== undefined)
          particles.push({
            ...style,
            position,
            vertices: sample.vertices,
          });
      }
    }
    return particles;
  }

  const shader = async (path: string) => decoder.decode(await read(`/${path}`));
  const [vertexShader, fragmentShader, noAlphaTestFragmentShader] =
    await Promise.all([
      shader(track.shaders.vertex),
      shader(track.shaders.fragment),
      noAlphaTestFragment === undefined
        ? undefined
        : shader(noAlphaTestFragment),
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
