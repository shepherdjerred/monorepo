import { z } from "zod";

const png = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.png$/);
const glsl = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.glsl$/);
const component = (lifetime: number) =>
  z.object({
    texture: png,
    indices: z.literal("000001000200000002000300"),
    lifetime: z.literal(Math.fround(lifetime)),
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
const particleTrack = z.object({
  schema: z.literal(1),
  kind: z.literal("recorded-native-terrain-particles"),
  build: z.literal("16.23.841.8428"),
  replaySha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("verified-partial-effects"),
  scope: z.literal("native-sampled-cold-remap"),
  effects: z
    .array(
      z.object({
        handle: z.number().int().positive().max(0xffff_ffff),
        start: z.number().nonnegative(),
        position: z.tuple([z.number(), z.number(), z.number()]),
      }),
    )
    .min(1)
    .max(100),
  components: z.tuple([component(0.2), component(0.3)]),
  textures: z.object({ palette: png, files: z.array(png).length(3) }),
  shaders: z.object({ vertex: glsl, fragment: glsl }),
});

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
  const track = particleTrack.parse(
    JSON.parse(decoder.decode(await read("/recorded-particles.json"))),
  );
  const maximumDuration = Math.max(
    ...track.components.map(({ lifetime }) => lifetime),
  );
  if (
    identity.build !== track.build ||
    identity.replaySha256 !== track.replaySha256 ||
    new Set(track.effects.map(({ handle }) => handle)).size !==
      track.effects.length ||
    track.effects.some(
      ({ start, position }, index) =>
        start + maximumDuration > identity.durationMilliseconds / 1000 ||
        (index > 0 && start < track.effects[index - 1]!.start) ||
        position.some((value) => !Number.isFinite(Math.fround(value))),
    )
  )
    throw new Error("The recorded particle track disagrees with this replay.");
  const expectedTextures = [
    track.textures.palette,
    ...track.components.map(({ texture }) => texture),
  ];
  if (
    new Set(expectedTextures).size !== 3 ||
    new Set(track.textures.files).size !== 3 ||
    !expectedTextures.every((path) => track.textures.files.includes(path))
  )
    throw new Error("The recorded particle textures disagree with the track.");

  const components = track.components.map(
    ({ texture, indices, lifetime, samples }) => {
      if (
        samples.some(
          ({ age }, index) =>
            age >= lifetime || (index > 0 && age <= samples[index - 1]!.age),
        )
      )
        throw new Error("The recorded particle samples are out of order.");
      return {
        texture,
        indices: decodeHex(indices),
        lifetime,
        samples: samples.map(({ age, vertices }) => ({
          age,
          vertices: decodeQuad(vertices),
        })),
      };
    },
  );
  function sampleAt(timeSeconds: number) {
    const particles = [];
    for (const { start, position } of track.effects) {
      if (start > timeSeconds) break;
      const age = timeSeconds - start;
      if (age >= maximumDuration) continue;
      for (const { texture, indices, lifetime, samples } of components) {
        if (age >= lifetime) continue;
        const sample = samples.findLast((entry) => entry.age <= age);
        if (sample !== undefined)
          particles.push({
            texture,
            position,
            indices,
            vertices: sample.vertices,
          });
      }
    }
    return particles;
  }

  const [vertexShader, fragmentShader] = await Promise.all(
    [track.shaders.vertex, track.shaders.fragment].map(async (path) =>
      decoder.decode(await read(`/${path}`)),
    ),
  );
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
    const palette = images.get(track.textures.palette)!;
    const baseTextures = new Map(
      track.components.map(({ texture }) => [texture, images.get(texture)!]),
    );
    return {
      assets: { vertexShader, fragmentShader, palette, baseTextures },
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
