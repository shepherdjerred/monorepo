import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { z } from "zod";
import { overlaySvg } from "#protocol/media-overlay.ts";
import {
  DocsFramesSchema,
  PresentationSchema,
  PublicMediaSchema,
} from "#protocol/media.ts";
import { renderMedia, sha256 } from "#src/capture/media.ts";
import { resolveAnnotations } from "#src/capture/annotations.ts";
import { verifyVideo } from "#src/capture/video-validation.ts";

describe("capture media", () => {
  it("resolves annotations using observed frame markers and rejects missing or overlong steps", () => {
    const cue = PresentationSchema.parse({
      schema: 1,
      name: "marker",
      alt: "Marker",
      caption: "",
      annotations: [
        {
          kind: "label",
          from: [0.2, 0.3],
          to: [0.2, 0.3],
          text: "Activate",
          startMs: 0,
          endMs: 500,
          atStep: "activate-start",
        },
      ],
    }).annotations[0];
    if (cue === undefined) throw new Error("Missing cue");
    expect(
      resolveAnnotations(
        [cue],
        [{ name: "activate-start", frame: 30 }],
        2000,
      )[0],
    ).toMatchObject({ startMs: 1000, endMs: 1500 });
    expect(() => resolveAnnotations([cue], [], 2000)).toThrow(
      "Missing recording marker",
    );
    expect(() =>
      resolveAnnotations([cue], [{ name: "activate-start", frame: 30 }], 1200),
    ).toThrow("beyond the clip");
  });

  it("requires the correct frame count and cadence in every encoded derivative", () => {
    const video = {
      codec_type: "video",
      width: 1280,
      height: 720,
      avg_frame_rate: "30/1",
      nb_read_frames: "30",
      duration: "1.000000",
    };
    expect(() => verifyVideo({ streams: [video] }, 30)).not.toThrow();
    for (const value of [
      { ...video, nb_read_frames: "29" },
      { ...video, avg_frame_rate: "60/1" },
      { ...video, duration: undefined },
      { ...video, width: 640 },
    ])
      expect(() => verifyVideo({ streams: [value] }, 30)).toThrow();
    expect(() =>
      verifyVideo({ streams: [video, { codec_type: "audio" }] }, 30),
    ).toThrow();
  });

  it("agrees with the language-neutral native docs receipt contract", async () => {
    const contract = z
      .object({
        version: z.literal(4),
        kind: z.literal("mc-docs-frames"),
        source: z.literal("minecraft-framebuffer"),
        fps: z.literal(30),
        width: z.literal(1280),
        height: z.literal(720),
        maximumFrames: z.literal(1800),
        maximumMarkers: z.literal(200),
        receipt: z.array(z.string()),
        written: z.array(z.string()),
        observation: z.array(z.string()),
        marker: z.array(z.string()),
      })
      .parse(
        await Bun.file(
          path.resolve(
            import.meta.dirname,
            "../../../the-storm/client/src/main/resources/storm-docs-video.json",
          ),
        ).json(),
      );
    expect(Object.keys(DocsFramesSchema.shape)).toEqual(
      expect.arrayContaining(contract.receipt),
    );
    expect(Object.keys(DocsFramesSchema.shape)).toHaveLength(
      contract.receipt.length,
    );
  });
  it("escapes annotation text and rejects coordinates and timelines outside their contract", () => {
    const cue = {
      kind: "label",
      from: [0.2, 0.3],
      to: [0.2, 0.3],
      text: '<script>&"',
      startMs: 0,
      endMs: 1000,
    };
    const presentation = PresentationSchema.parse({
      schema: 1,
      name: "test",
      alt: "Example",
      caption: "",
      annotations: [cue],
    });
    expect(overlaySvg(presentation.annotations, 1280, 720)).toContain(
      "&lt;script&gt;&amp;&quot;",
    );
    expect(
      PresentationSchema.safeParse({
        ...presentation,
        annotations: [{ ...cue, from: [-0.1, 0] }],
      }).success,
    ).toBe(false);
    expect(
      PresentationSchema.safeParse({
        ...presentation,
        annotations: [{ ...cue, endMs: 0 }],
      }).success,
    ).toBe(false);
  });

  it("renders both plain and annotated images without altering the original", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "mc-capture-media-"),
    );
    try {
      const source = path.join(directory, "source.png");
      await sharp({
        create: { width: 640, height: 360, channels: 3, background: "#345678" },
      })
        .png()
        .toFile(source);
      const original = await sha256(source);
      const presentation = path.join(directory, "presentation.json");
      await Bun.write(
        presentation,
        JSON.stringify({
          schema: 1,
          name: "example",
          alt: "Test frame",
          caption: "Caption",
          annotations: [
            {
              kind: "arrow",
              from: [0.2, 0.3],
              to: [0.6, 0.7],
              text: "Here",
              startMs: 0,
              endMs: 1000,
            },
          ],
        }),
      );
      const output = path.join(directory, "render");
      const manifest = await renderMedia(source, presentation, output);
      expect(PublicMediaSchema.parse(manifest).src).toBe(
        "/media/example/original.webp",
      );
      expect(await sha256(source)).toBe(original);
      expect(await sha256(path.join(output, "original.webp"))).not.toBe(
        await sha256(path.join(output, "annotated.webp")),
      );
      expect(
        await readFile(path.join(output, "media.json"), "utf8"),
      ).not.toContain(source);
      await expect(renderMedia(source, presentation, output)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the RWF receipt separate and rejects skipped docs frames", () => {
    expect(
      DocsFramesSchema.safeParse({ schema: 1, kind: "rwf-rendered-frames" })
        .success,
    ).toBe(false);
    expect(
      DocsFramesSchema.safeParse({
        schema: 4,
        kind: "mc-docs-frames",
        source: "minecraft-framebuffer",
        fps: 30,
        requestedFrames: 1,
        complete: true,
        error: "",
        frames: [],
      }).success,
    ).toBe(false);
  });
});
