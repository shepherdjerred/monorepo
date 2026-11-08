import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runMediaTool } from "#filesystem/media-tools.ts";

/** Disposable real MKV with known video/audio and independently labelled English/Simplified Chinese text tracks. */
export async function movieVideoFixture(
  width = 1920,
  englishTracks = [{ forced: false, hearingImpaired: false }],
  options: { bitrateKbps?: number } = {},
) {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-movie-video-")),
  );
  try {
    const english = path.join(directory, "english.srt");
    const chinese = path.join(directory, "chinese.srt");
    await writeFile(
      english,
      "1\n00:00:00,000 --> 00:00:01,500\nWelcome home. This is a synthetic caption fixture.\n",
    );
    await writeFile(
      chinese,
      "1\n00:00:00,000 --> 00:00:01,500\n这是一个简体中文字幕测试，汉语龙马风云国书车头发现。\n",
    );
    const output = path.join(directory, "fixture.mkv");
    await runMediaTool(
      "ffmpeg",
      [
        "-nostdin",
        "-n",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${String(width)}x${String(Math.floor((width * 9) / 16))}:r=1:d=2`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=8000:cl=mono",
        "-i",
        english,
        "-i",
        chinese,
        "-t",
        "2",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        ...englishTracks.flatMap(() => ["-map", "2:s:0"]),
        "-map",
        "3:s:0",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        ...(options.bitrateKbps === undefined
          ? []
          : [
              "-b:v",
              `${String(options.bitrateKbps)}k`,
              "-minrate",
              `${String(options.bitrateKbps)}k`,
              "-maxrate",
              `${String(options.bitrateKbps)}k`,
              "-bufsize",
              `${String(options.bitrateKbps)}k`,
              "-x264-params",
              "nal-hrd=cbr:force-cfr=1",
            ]),
        "-c:a",
        "aac",
        "-c:s",
        "srt",
        "-metadata:s:a:0",
        "language=eng",
        ...englishTracks.flatMap((track, index) => [
          `-metadata:s:s:${String(index)}`,
          "language=eng",
          `-disposition:s:${String(index)}`,
          [
            track.forced ? "forced" : "",
            track.hearingImpaired ? "hearing_impaired" : "",
          ]
            .filter((value) => value !== "")
            .join("+") || "0",
        ]),
        `-metadata:s:s:${String(englishTracks.length)}`,
        "language=zho",
        output,
      ],
      { maxBytes: 1024, timeoutMs: 30_000 },
    );
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
