import { mkdtemp, readdir, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, it, expect } from "vitest";
import { exportMedia } from "#src/capture/export.ts";
import { renderMedia, sha256 } from "#src/capture/media.ts";
import { RunSchema } from "#src/capture/model.ts";

async function fixture(root: string) {
  const source = path.join(root, "original.png");
  const presentation = path.join(root, "presentation.json");
  const rendered = path.join(root, "rendered");
  await mkdir(rendered);
  await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#123456" },
  })
    .png()
    .toFile(source);
  await Bun.write(
    presentation,
    JSON.stringify({
      schema: 1,
      name: "example",
      alt: 'Example <"tag">',
      caption: "",
      annotations: [],
    }),
  );
  await renderMedia(source, presentation, path.join(rendered, "example"));
  const run = RunSchema.parse({
    schema: 1,
    id: "capture-test",
    target: "live",
    reason: "test",
    name: "XiguaJerred",
    inspectors: [],
    server: null,
    baseline: null,
    scene: "private-scene",
    sceneHash: "hash",
    box: {
      world: "world",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    },
    anchor: [0, 0, 0],
    state: "complete",
    checkpoint: null,
    snapshot: null,
    inspection: null,
    origin: null,
    staging: null,
    cleanup: [],
    captures: [
      {
        name: "example",
        source,
        sourceHash: await sha256(source),
        presentation,
      },
    ],
    error: "",
  });
  return { run, rendered, docs: path.join(root, "public") };
}

describe("capture export", () => {
  it("exports only verified public derivatives and preserves prior media privately", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-export-"));
    try {
      const { run, rendered, docs } = await fixture(root);
      const snippets = await exportMedia(run, rendered, docs);
      expect(snippets[0]).toContain("&lt;&quot;tag&quot;&gt;");
      const exported = await readdir(path.join(docs, "media/example"));
      expect(exported.toSorted()).toEqual([
        "annotated.webp",
        "media.json",
        "original.webp",
        "poster.webp",
      ]);
      await exportMedia(run, rendered, docs);
      expect(await readdir(path.join(root, "exports-before"))).toHaveLength(1);
      expect(
        await Bun.file(path.join(docs, "media/example/media.json")).text(),
      ).not.toContain("private");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("refuses rehearsal output, incomplete runs, changed originals, and edited derivatives", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-export-"));
    try {
      const { run, rendered, docs } = await fixture(root);
      await expect(
        exportMedia({ ...run, target: "sandbox-1" }, rendered, docs),
      ).rejects.toThrow("completed live");
      await expect(
        exportMedia({ ...run, state: "needs-recovery" }, rendered, docs),
      ).rejects.toThrow("completed live");
      await Bun.write(path.join(rendered, "example/original.webp"), "changed");
      await expect(exportMedia(run, rendered, docs)).rejects.toThrow(
        "Rendered output changed",
      );
      const capture = run.captures[0];
      if (capture === undefined) throw new Error("Missing capture");
      await Bun.write(capture.source, "changed");
      await expect(exportMedia(run, rendered, docs)).rejects.toThrow(
        "Capture or annotations changed",
      );
      expect(
        await Bun.file(path.join(docs, "media/example/media.json")).exists(),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("never overwrites a destination containing unrelated files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-export-"));
    try {
      const { run, rendered, docs } = await fixture(root);
      const destination = path.join(docs, "media/example");
      await mkdir(destination, { recursive: true });
      await Bun.write(path.join(destination, "notes.txt"), "keep me");
      await expect(exportMedia(run, rendered, docs)).rejects.toThrow(
        "unrelated files",
      );
      expect(await Bun.file(path.join(destination, "notes.txt")).text()).toBe(
        "keep me",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
