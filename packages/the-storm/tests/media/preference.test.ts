import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { blindVideo, run, validateVideo } from "#learning/preference/media.ts";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "rwf-media-unit-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("strips identifying tags and audio from real video while retaining the frozen frame contract", async () => {
  const source = path.join(directory, "learned-unit-fixture.mp4");
  const output = path.join(directory, "pair-01-A.mp4");
  await run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=1280x720:r=30:d=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=30",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    "-c:a",
    "aac",
    "-metadata",
    "title=learned unit fixture",
    "-metadata",
    "comment=unit actor identity",
    source,
  ]);
  await blindVideo(source, output);
  const probe = await run([
    "ffprobe",
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    output,
  ]);
  expect(probe).not.toContain("learned unit fixture");
  expect(probe).not.toContain("unit actor identity");
  expect(probe).not.toContain('"codec_type": "audio"');
  await expect(blindVideo(source, output)).rejects.toThrow();
}, 60_000);

it("rejects clipped or resized footage instead of silently changing the comparison", async () => {
  const source = path.join(directory, "short-unit-fixture.mp4");
  await run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=640x360:r=30:d=1",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    source,
  ]);
  await expect(validateVideo(source)).rejects.toThrow("30-second");
});
