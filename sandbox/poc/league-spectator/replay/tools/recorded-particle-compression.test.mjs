import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { packageLocalRecordedParticles } from "./build-local-scout-terrain-package.mjs";

const bundle = await Bun.build({
  entrypoints: [
    fileURLToPath(new URL("../scout-terrain-particles.ts", import.meta.url)),
  ],
  target: "browser",
  plugins: [
    {
      name: "resolve-scout-particle-test-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /^zod$/ }, ({ path }) => ({
          path: Bun.resolveSync(
            path,
            fileURLToPath(
              new URL(
                "../../../../../packages/scout-for-lol/packages/app",
                import.meta.url,
              ),
            ),
          ),
        }));
      },
    },
  ],
});
const { loadRecordedTerrainParticles, readRecordedParticleTrackJson } =
  await import(
    `data:text/javascript;base64,${Buffer.from(await bundle.outputs[0].arrayBuffer()).toString("base64")}`
  );
const trackFile = "recorded-particles.json";
const gzipFile = `${trackFile}.gz`;
const readFrom = (files) => async (path) => {
  const bytes = files.get(path.slice(1));
  if (!bytes) throw Error(`Missing ${path}`);
  return Uint8Array.from(bytes).buffer;
};
const signal = () => new AbortController().signal;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("fully loads the same shaders, textures, and samples from raw and compact tracks", async () => {
  const resource = (byte, extension) =>
    `recorded-particles/${byte.repeat(64)}.${extension}`;
  const texture = resource("a", "png");
  const palette = resource("b", "png");
  const vertex = resource("c", "glsl");
  const fragment = resource("d", "glsl");
  const identity = {
    build: "16.23.841.8428",
    replaySha256: "1".repeat(64),
    durationMilliseconds: 2000,
  };
  const raw = Buffer.from(
    JSON.stringify({
      schema: 2,
      kind: "recorded-native-terrain-particles",
      build: identity.build,
      replaySha256: identity.replaySha256,
      status: "verified-partial-effects",
      scope: "native-sampled-cold-remap",
      shaders: { vertex, fragment },
      effects: [
        { handle: 1, start: 0.5, position: [10, 20, 30], family: "test" },
      ],
      families: [
        {
          id: "test",
          components: [
            {
              texture,
              palette,
              blend: "src-alpha-one",
              centerY: 0,
              indices: "000001000200000002000300",
              lifetime: 0.25,
              samples: [{ age: 0, vertices: "00".repeat(112) }],
            },
          ],
        },
      ],
      textures: { files: [texture, palette] },
    }),
  );
  const vertexSource = "void main() { gl_Position = vec4(0.0); }";
  const fragmentSource = "void main() { gl_FragColor = vec4(1.0); }";
  const rawFiles = new Map([
    [trackFile, raw],
    [vertex, Buffer.from(vertexSource)],
    [fragment, Buffer.from(fragmentSource)],
    [texture, Uint8Array.of(1)],
    [palette, Uint8Array.of(2)],
  ]);
  const compactFiles = new Map(rawFiles);
  compactFiles.set(
    trackFile,
    Buffer.from(
      JSON.stringify({
        kind: "gzip-recorded-native-terrain-particles",
        schema: 1,
        bytes: raw.length,
        sha256: sha256(raw),
      }),
    ),
  );
  compactFiles.set(gzipFile, gzipSync(raw));

  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  let closed = 0;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async (image, options) => {
      expect(image.type).toBe("image/png");
      expect(options).toEqual({
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
      return {
        bytes: new Uint8Array(await image.arrayBuffer()),
        close() {
          closed++;
        },
      };
    },
  });
  try {
    for (const files of [rawFiles, compactFiles]) {
      const loaded = await loadRecordedTerrainParticles(
        readFrom(files),
        identity,
        signal(),
      );
      try {
        expect(loaded.assets.vertexShader).toBe(vertexSource);
        expect(loaded.assets.fragmentShader).toBe(fragmentSource);
        expect(loaded.assets.baseTextures.get(texture)?.bytes).toEqual(
          Uint8Array.of(1),
        );
        expect(loaded.assets.palettes.get(palette)?.bytes).toEqual(
          Uint8Array.of(2),
        );
        expect(loaded.sampleAt(0.49)).toEqual([]);
        expect(loaded.sampleAt(0.5)).toMatchObject([
          {
            position: [10, 20, 30],
            vertices: new Uint8Array(112),
            indices: Uint8Array.of(0, 0, 1, 0, 2, 0, 0, 0, 2, 0, 3, 0),
          },
        ]);
        expect(loaded.sampleAt(0.75)).toEqual([]);
      } finally {
        loaded.closeImages();
      }
    }
    expect(closed).toBe(4);
  } finally {
    if (original)
      Object.defineProperty(globalThis, "createImageBitmap", original);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
  }
});

test("preserves raw legacy files and round-trips compressed bytes losslessly", async () => {
  const legacy = new Map([[trackFile, Buffer.from('{"schema":6}')]]);
  expect(packageLocalRecordedParticles(legacy)).toBe(legacy);
  expect(
    await readRecordedParticleTrackJson(readFrom(legacy), signal()),
  ).toEqual({ schema: 6 });
  const payload = { geometry: "1234567890".repeat(2_000_000) };
  const bytes = Buffer.from(JSON.stringify(payload));
  const raw = new Map([[trackFile, bytes]]);
  const packed = packageLocalRecordedParticles(raw);
  expect(packed.get(gzipFile).length).toBeLessThan(bytes.length / 10);
  expect(raw.get(trackFile)).toBe(bytes);
  expect(
    await readRecordedParticleTrackJson(readFrom(packed), signal()),
  ).toEqual(payload);
});

test("rejects incorrect decoded length, digest, corrupt gzip, and cancellation", async () => {
  const raw = Buffer.from('{"schema":6}');
  const envelope = {
    kind: "gzip-recorded-native-terrain-particles",
    schema: 1,
    bytes: raw.length,
    sha256: sha256(raw),
  };
  const gzip = gzipSync(raw);
  const files = (overrides = {}, compressed = gzip) =>
    new Map([
      [trackFile, Buffer.from(JSON.stringify({ ...envelope, ...overrides }))],
      [gzipFile, compressed],
    ]);
  for (const [input, message] of [
    [files({ bytes: raw.length - 1 }), "exceeded its decoded size"],
    [files({ bytes: raw.length + 1 }), "unexpected decoded size"],
    [files({ sha256: "0".repeat(64) }), "decoded digest differs"],
    [files({ bytes: 64 * 1024 * 1024 + 1 }), undefined],
    [files({}, Buffer.from("not gzip")), undefined],
  ]) {
    await expect(
      readRecordedParticleTrackJson(readFrom(input), signal()),
    ).rejects.toThrow(message);
  }
  const abort = new AbortController();
  const read = readFrom(files());
  await expect(
    readRecordedParticleTrackJson(async (path) => {
      if (path.endsWith(".gz")) abort.abort(Error("Stopped loading"));
      return read(path);
    }, abort.signal),
  ).rejects.toThrow("Stopped loading");
});
