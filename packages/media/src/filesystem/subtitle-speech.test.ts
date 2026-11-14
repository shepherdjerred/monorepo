import { afterEach, expect, it } from "vitest";
import nodePath from "node:path";
import { tmpdir } from "node:os";
import {
  mkdtemp,
  realpath,
  readdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { measureSubtitleSpeech } from "./subtitle-speech.ts";
import { MediaToolError, type RunMediaTool } from "./media-tools.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
const original = "1\n00:00:01,000 --> 00:00:03,000\nHuman dialogue\n";
const synchronized = original
  .replace("01,000", "02,000")
  .replace("03,000", "04,000");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const limitedRun: RunMediaTool = async (tool, args) => {
  if (args[0] === "audio") {
    await writeFile(args[2]!, "speech", { flag: "wx" });
    return new Uint8Array();
  }
  throw new MediaToolError(tool, "limit");
};
async function input() {
  const controlRoot = await realpath(
    await mkdtemp(nodePath.join(tmpdir(), "caption-speech-test-")),
  );
  directories.push(controlRoot);
  return {
    videoPath: "/library/film.mkv",
    controlRoot,
    text: original,
    format: "srt" as const,
    runtimeMs: 120_000,
    videoChecksum: "a".repeat(64),
    subtitleChecksum: hash(original),
    synchronize: true,
    signal: new AbortController().signal,
    checkpoint: () => Promise.resolve(),
  };
}
it.each([
  { runtimeMs: 120_000, maximumOffset: "60", speechMs: 60_000 },
  { runtimeMs: 32_000, maximumOffset: "16", speechMs: 24_000 },
])(
  "uses one audio measurement and a reference-bounded offset for $runtimeMs ms",
  async ({ runtimeMs, maximumOffset, speechMs }) => {
    const i = { ...(await input()), runtimeMs },
      calls: string[][] = [];
    const run: RunMediaTool = async (tool, args, options) => {
      calls.push([tool, ...args]);
      expect(options.timeoutMs).toBe(1_800_000);
      if (args[0] === "audio")
        await writeFile(args[2]!, "private speech vector", { flag: "wx" });
      if (tool === "ffsubsync") {
        expect(args).toContain("--no-fix-framerate");
        expect(args).toContain("--gss");
        expect(args[args.indexOf("--max-offset-seconds") + 1]).toBe(
          maximumOffset,
        );
        expect(args).not.toContain(i.videoPath);
        await writeFile(args[args.indexOf("-o") + 1]!, synchronized, {
          flag: "wx",
        });
      }
      if (args[0] === "coverage") {
        expect(JSON.parse(await readFile(args[2]!, "utf8"))).toEqual([
          [2000, 4000],
        ]);
        return new TextEncoder().encode(
          JSON.stringify({
            speechMs,
            coveredSpeechMs: speechMs,
            windows: Array.from({ length: 12 }, () => ({
              speechMs: speechMs / 12,
              coveredSpeechMs: speechMs / 12,
            })),
          }),
        );
      }
      return new Uint8Array();
    };
    const result = await measureSubtitleSpeech(i, run);
    expect(result.text).toBe(synchronized);
    expect(result.proof.subtitleChecksum).toBe(hash(synchronized));
    expect(calls.map((c) => c[0])).toEqual([
      "media-subtitle-analysis",
      "ffsubsync",
      "media-subtitle-analysis",
    ]);
    expect(i.text).toBe(original);
    expect(await readdir(i.controlRoot)).toEqual([]);
  },
);
it("leaves source bytes intact and removes owned partials when the sync tool fails", async () => {
  const i = await input();
  await expect(measureSubtitleSpeech(i, limitedRun)).rejects.toThrow("limit");
  expect(i.text).toBe(original);
  expect(await readdir(i.controlRoot)).toEqual([]);
});
it("refuses an external output symlink without changing the external file", async () => {
  const i = await input();
  const elsewhere = await realpath(
    await mkdtemp(nodePath.join(tmpdir(), "caption-external-test-")),
  );
  directories.push(elsewhere);
  const outside = nodePath.join(elsewhere, "keep.srt");
  await writeFile(outside, original);
  const run: RunMediaTool = async (tool, args) => {
    if (args[0] === "audio")
      await writeFile(args[2]!, "speech", { flag: "wx" });
    if (tool === "ffsubsync")
      await symlink(outside, args[args.indexOf("-o") + 1]!);
    return new Uint8Array();
  };
  await expect(measureSubtitleSpeech(i, run)).rejects.toThrow(
    "Invalid synchronized subtitle output",
  );
  expect(await readFile(outside, "utf8")).toBe(original);
  expect(await readdir(i.controlRoot)).toEqual([]);
});
