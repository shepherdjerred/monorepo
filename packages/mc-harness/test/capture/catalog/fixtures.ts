import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { defineCaptureSuite } from "#src/capture/suite/define.ts";
import type { Presentation, PublicMedia } from "#protocol/media.ts";

/** Shared public-media fixture for unit and extended catalog checks. */
export const shot: Presentation = {
  schema: 1,
  name: "test-shot",
  alt: "Sign <script>alert(1)</script>",
  caption: "A & B",
  annotations: [],
};
export const suite = defineCaptureSuite({
  id: "test-suite",
  bootstrap: [0, 0, 0],
  patches: [
    { world: "world", min: [-16, -16], max: [16, 16], paddingChunks: 2 },
  ],
  legacyOutputs: [{ shot: shot.name, path: "/screenshots/test.webp" }],
  scenarios: [
    {
      id: "test-scene",
      anchor: [0, 0, 0],
      world: "world",
      helpers: [],
      shots: [shot],
      scene: {
        name: "test-scene",
        description: "Test",
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        staging: [3, 0, 0],
        inspectors: [],
        setup: () => Promise.resolve(),
        run: () => Promise.resolve(),
      },
    },
  ],
});
export const manifest: PublicMedia = {
  ...shot,
  kind: "image",
  width: 32,
  height: 18,
  src: "/media/test-shot/original.webp",
  poster: "/media/test-shot/poster.webp",
};

export async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-catalog-test-"));
  try {
    await mkdir(path.join(root, "media/test-shot"), { recursive: true });
    await mkdir(path.join(root, "screenshots"));
    const bytes = await sharp({
      create: { width: 32, height: 18, channels: 3, background: "green" },
    })
      .webp()
      .toBuffer();
    for (const file of ["original.webp", "poster.webp", "annotated.webp"])
      await Bun.write(path.join(root, "media/test-shot", file), bytes);
    await Bun.write(path.join(root, "screenshots/test.webp"), bytes);
    await Bun.write(
      path.join(root, "media/test-shot/media.json"),
      JSON.stringify(manifest),
    );
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
