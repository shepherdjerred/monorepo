import { it, expect } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { auditCatalog } from "#src/capture/suite/catalog/audit.ts";
import { reviewCatalog } from "#src/capture/suite/catalog/review.ts";
import { command } from "#src/capture/suite/process.ts";
import type { Annotation } from "#protocol/media.ts";
import { shot, suite, manifest, fixture } from "./fixtures.ts";

it("checks clip dimensions and cue duration on real encoded video", async () => {
  await fixture(async (root) => {
    const directory = path.join(root, "media/test-shot");
    await rm(path.join(root, "screenshots/test.webp"));
    await command([
      "ffmpeg",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=32x18:r=30",
      "-frames:v",
      "3",
      "-pix_fmt",
      "yuv420p",
      path.join(directory, "clip.mp4"),
    ]);
    await Bun.write(
      path.join(directory, "annotated.mp4"),
      Bun.file(path.join(directory, "clip.mp4")),
    );
    const cue: Annotation = {
      kind: "label",
      text: "Cue",
      from: [0, 0],
      to: [1, 1],
      startMs: 0,
      endMs: 1000,
    };
    const videoSuite = {
      ...suite,
      legacyOutputs: [],
      scenarios: suite.scenarios.map((s) => ({
        ...s,
        shots: [{ ...shot, annotations: [cue] }],
      })),
    };
    await Bun.write(
      path.join(directory, "media.json"),
      JSON.stringify({
        ...manifest,
        kind: "video",
        src: "/media/test-shot/clip.mp4",
        annotations: [cue],
      }),
    );
    const overlong = await auditCatalog(videoSuite, root);
    expect(overlong.issues[0]?.message).toContain("beyond clip");
    await Bun.write(
      path.join(directory, "media.json"),
      JSON.stringify({
        ...manifest,
        kind: "video",
        src: "/media/test-shot/clip.mp4",
      }),
    );
    const catalog = await auditCatalog({ ...suite, legacyOutputs: [] }, root);
    expect(catalog.issues).toEqual([]);
    expect(
      await reviewCatalog(catalog, root, path.join(root, "video-report")),
    ).toMatchObject({ cards: 3 });
  });
});
