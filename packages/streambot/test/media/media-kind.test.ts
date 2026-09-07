import { describe, expect, test } from "vitest";
import {
  classifyMediaKind,
  MediaKindSchema,
  MediaModeSchema,
  reconcileMediaKind,
  type MediaKindDecision,
  type MediaKindInput,
  type MediaKindPass,
} from "@shepherdjerred/streambot/sources/media-kind.ts";
import { finalizeResolved } from "@shepherdjerred/streambot/sources/resolve.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import type { MediaInfo } from "@shepherdjerred/streambot/sources/probe.ts";

/**
 * The classifier is a precedence table, so it is tested as one: every row states the signals, the
 * pass, and both halves of the answer. `decidedBy` is asserted alongside `kind` deliberately — a
 * row that reaches the right kind via the wrong rule is a latent bug, because the next signal to
 * change will move it somewhere unexpected.
 *
 * The yt-dlp shapes below are the real ones captured from `yt-dlp --dump-json` (2026.08.19), not
 * invented: an official music video carries `categories: ["Music"]` with no track tags, an
 * auto-generated topic upload carries both, and a conference talk carries a non-music category.
 */
const CASES: readonly {
  readonly name: string;
  readonly input: MediaKindInput;
  readonly pass: MediaKindPass;
  readonly expected: MediaKindDecision;
}[] = [
  {
    // An instruction, not a guess: the classifier honours it and `reconcileMediaKind` reports the
    // combination as unsupported, rather than switching transport behind the caller's back.
    name: "an explicit mode: video outranks the missing picture on the video pass",
    input: { mode: "video", hasVideoStream: false },
    pass: "video",
    expected: { kind: "video", decidedBy: "mode" },
  },
  {
    name: "no video stream beats every yt-dlp signal pointing at video",
    input: { hasVideoStream: false, categories: ["Gaming"], provider: "url" },
    pass: "video",
    expected: { kind: "music", decidedBy: "no-video-stream" },
  },
  {
    name: "an unknown video stream is not a denial — it falls through",
    input: { categories: ["Music"] },
    pass: "video",
    expected: { kind: "music", decidedBy: "categories" },
  },
  {
    name: "mode: video beats yt-dlp signals that say music",
    input: {
      mode: "video",
      categories: ["Music"],
      track: "Never Gonna Give You Up",
      artist: "Rick Astley",
      provider: "youtube",
    },
    pass: "video",
    expected: { kind: "video", decidedBy: "mode" },
  },
  {
    name: "mode: music beats yt-dlp signals that say video",
    input: { mode: "music", categories: ["Gaming"], provider: "youtube" },
    pass: "video",
    expected: { kind: "music", decidedBy: "mode" },
  },
  {
    name: "mode: auto is not an override — it defers to the signals",
    input: { mode: "auto", categories: ["Gaming"], provider: "youtube" },
    pass: "video",
    expected: { kind: "video", decidedBy: "categories" },
  },
  {
    name: "an absent mode behaves exactly like auto",
    input: { categories: ["Gaming"], provider: "youtube" },
    pass: "video",
    expected: { kind: "video", decidedBy: "categories" },
  },
  {
    name: "Rick Astley official video: categories say Music, no track tags",
    input: {
      categories: ["Music"],
      track: null,
      artist: null,
      extractorKey: "Youtube",
      provider: "youtube",
    },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "categories" },
  },
  {
    name: "categories match is case-insensitive",
    input: { categories: ["music"], provider: "url" },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "categories" },
  },
  {
    name: "track/artist tags alone (auto-generated topic upload, no categories)",
    input: {
      track: "Never Gonna Give You Up",
      artist: "Rick Astley",
      provider: "url",
    },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "track-tags" },
  },
  {
    name: "artist alone is enough",
    input: { artist: "Rick Astley", provider: "url" },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "track-tags" },
  },
  {
    name: "blank track tags are not tags",
    input: { track: "  ", artist: "", provider: "url" },
    pass: "audio-first",
    expected: { kind: "video", decidedBy: "default" },
  },
  {
    name: "soundcloud extractor, on the audio-first pass where rule 1 is blind",
    input: { extractorKey: "Soundcloud", provider: "url" },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "extractor" },
  },
  {
    name: "soundcloud sub-extractors match by prefix",
    input: { extractorKey: "SoundcloudSet", provider: "url" },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "extractor" },
  },
  {
    name: "bandcamp extractor",
    input: { extractorKey: "Bandcamp", provider: "url" },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "extractor" },
  },
  {
    name: "JSConf talk: a non-music category outranks the YouTube default",
    input: {
      categories: ["Science & Technology"],
      track: null,
      artist: null,
      extractorKey: "Youtube",
      provider: "youtube",
    },
    pass: "audio-first",
    expected: { kind: "video", decidedBy: "categories" },
  },
  {
    name: "YouTube gaming video is video, not the YouTube music default",
    input: {
      categories: ["Gaming"],
      extractorKey: "Youtube",
      provider: "youtube",
    },
    pass: "audio-first",
    expected: { kind: "video", decidedBy: "categories" },
  },
  {
    name: "YouTube with no other signal leans music",
    input: { extractorKey: "Youtube", provider: "youtube" },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "provider-default" },
  },
  {
    name: "an empty categories array carries no signal",
    input: { categories: [], provider: "youtube" },
    pass: "audio-first",
    expected: { kind: "music", decidedBy: "provider-default" },
  },
  {
    name: "an arbitrary link stays video, as before this split",
    input: { provider: "url", extractorKey: "Generic" },
    pass: "audio-first",
    expected: { kind: "video", decidedBy: "default" },
  },
  {
    name: "a local library file stays video",
    input: { provider: "local", hasVideoStream: true },
    pass: "video",
    expected: { kind: "video", decidedBy: "default" },
  },
  {
    name: "a local file with no video stream is music (an audio file in the library)",
    input: { provider: "local", hasVideoStream: false },
    pass: "video",
    expected: { kind: "music", decidedBy: "no-video-stream" },
  },
  {
    name: "archive.org mp3: an UNKNOWN video stream must not be read as a denial",
    // archive.org reports `vcodec: null`, which `selectedHasVideoStream` propagates as `undefined`.
    // The classifier must leave it alone rather than guessing either way — the ffprobe
    // reconciliation is what settles this item, and it settles it correctly.
    input: {
      hasVideoStream: undefined,
      extractorKey: "InternetArchive",
      provider: "url",
    },
    pass: "video",
    expected: { kind: "video", decidedBy: "default" },
  },
  {
    name: "no signals at all",
    input: {},
    pass: "video",
    expected: { kind: "video", decidedBy: "default" },
  },
];

describe("classifyMediaKind", () => {
  for (const { name, input, pass, expected } of CASES) {
    test(name, () => {
      expect(classifyMediaKind(input, pass)).toEqual(expected);
    });
  }
});

describe("classifyMediaKind — the audio-first pass suppresses rule 1", () => {
  // Resolution asks yt-dlp for `bestaudio/best` first so a song costs one subprocess. That makes
  // "the selected stream has no picture" trivially true of EVERY item on that pass, song or movie
  // alike. Were rule 1 live there, every URL in the queue would classify as music and the Go Live
  // transport would never be reached at all.
  test("a talk is not turned into music by the audio pass's own selection", () => {
    expect(
      classifyMediaKind(
        {
          hasVideoStream: false,
          categories: ["Science & Technology"],
          provider: "youtube",
        },
        "audio-first",
      ),
    ).toEqual({ kind: "video", decidedBy: "categories" });
  });

  test("an explicit mode: video survives the audio-first pass", () => {
    // This is what makes the second pass happen at all, and it is why the guard has to be
    // reasserted later against the final input — see reconcileMediaKind below.
    expect(
      classifyMediaKind(
        { mode: "video", hasVideoStream: false },
        "audio-first",
      ),
    ).toEqual({ kind: "video", decidedBy: "mode" });
  });

  test("the same input is left for the reconciler on the video pass", () => {
    // The classifier honours the instruction; it is `reconcileMediaKind` that decides an explicit
    // video request on a picture-less input is unsupported rather than quietly switching it to
    // music, which would make the rollout flag a switch that switches nothing off.
    expect(
      classifyMediaKind({ mode: "video", hasVideoStream: false }, "video"),
    ).toEqual({ kind: "video", decidedBy: "mode" });
  });
});

describe("reconcileMediaKind", () => {
  // The end of the story the two tests above start: an audio-only source typed as video reaches
  // here, and the ffprobe of the FINAL chosen input is what catches it — before the fork's
  // attachPipeline hard-throws "No video stream in media" with ffmpeg already spawned.
  test("demotes an INFERRED video guess the probe contradicts", () => {
    expect(reconcileMediaKind("video", false, undefined)).toEqual({
      outcome: "demote",
      decision: { kind: "music", decidedBy: "no-video-stream" },
    });
  });

  test("reports an EXPLICIT video request on an audio-only source as unsupported", () => {
    // Not demotable. `"video"` is only ever explicit here — a user typed `mode:video`, or the
    // rollout flag is off and forced the pre-split transport. Quietly playing it as music ignores
    // both, and in the rollout case makes the flag a switch that switches nothing off.
    expect(reconcileMediaKind("video", false, "video")).toEqual({
      outcome: "unsupported",
    });
  });

  test("leaves a video item alone when the probe found a picture", () => {
    expect(reconcileMediaKind("video", true, undefined)).toBeUndefined();
    expect(reconcileMediaKind("video", true, "video")).toBeUndefined();
  });

  test("leaves a video item alone when the probe could not tell", () => {
    // A failed probe (403 on a signed URL, unreadable container) is not evidence of absence.
    expect(reconcileMediaKind("video", undefined, undefined)).toBeUndefined();
    expect(reconcileMediaKind("video", undefined, "video")).toBeUndefined();
  });

  test("never promotes music to video, whatever the probe saw", () => {
    // The metadata pass already weighed every signal that says "this is a song"; finding a picture
    // says nothing against them — a music video has one.
    expect(reconcileMediaKind("music", true, undefined)).toBeUndefined();
    expect(reconcileMediaKind("music", false, undefined)).toBeUndefined();
    expect(reconcileMediaKind("music", undefined, undefined)).toBeUndefined();
  });
});

describe("MediaMode / MediaKind schemas", () => {
  test("mode is the user request and admits auto; kind is the resolved fact and does not", () => {
    expect(MediaModeSchema.options).toEqual(["auto", "music", "video"]);
    expect(MediaKindSchema.options).toEqual(["music", "video"]);
    expect(MediaKindSchema.safeParse("auto").success).toBe(false);
  });
});

describe("finalizeResolved — folding the final probe into the resolved source", () => {
  const SPLIT_VIDEO: ResolvedSource = {
    title: "A Talk",
    ffmpegInput: "https://cdn.invalid/video",
    mediaKind: "video",
    audioInput: "https://cdn.invalid/audio",
    audioInputHeaders: { "User-Agent": "Mozilla/5.0" },
    ffmpegInputHeaders: { "User-Agent": "Mozilla/5.0" },
    chapters: [],
  };
  const withVideo: MediaInfo = {
    videoCodec: "h264",
    width: 1280,
    height: 720,
    pixelFormat: "yuv420p",
    hdr: false,
    audioCodec: "aac",
    audioChannels: 2,
    durationSeconds: 1800,
  };
  const noVideo: MediaInfo = {
    ...withVideo,
    videoCodec: "unknown",
    width: undefined,
    height: undefined,
  };

  test("drops the second input when it downgrades to music", () => {
    // The reason this matters: the music pipeline runs ONE input with `-vn`. A leftover `audioInput`
    // would have `prepareStream` emit `-map 1:a:0` against an input the audio path never opens.
    const finalized = finalizeResolved(SPLIT_VIDEO, noVideo, undefined);
    expect(finalized.mediaKind).toBe("music");
    expect(finalized.audioInput).toBeUndefined();
    expect(finalized.audioInputHeaders).toBeUndefined();
    // The PRIMARY input and its headers must survive — that is the stream we are about to play.
    expect(finalized.ffmpegInput).toBe("https://cdn.invalid/video");
    expect(finalized.ffmpegInputHeaders).toEqual({
      "User-Agent": "Mozilla/5.0",
    });
  });

  test("leaves a real video item untouched, second input and all", () => {
    const finalized = finalizeResolved(SPLIT_VIDEO, withVideo, undefined);
    expect(finalized.mediaKind).toBe("video");
    expect(finalized.audioInput).toBe("https://cdn.invalid/audio");
    expect(finalized.audioInputHeaders).toEqual({
      "User-Agent": "Mozilla/5.0",
    });
  });

  test("a failed probe changes nothing at all", () => {
    // `null` is "could not look", not "looked and found nothing" — a 403 on a signed URL must not
    // silently reroute a movie to the music transport.
    const finalized = finalizeResolved(SPLIT_VIDEO, null, undefined);
    expect(finalized.mediaKind).toBe("video");
    expect(finalized.audioInput).toBe("https://cdn.invalid/audio");
    expect(finalized.hdr).toBeUndefined();
    expect(finalized.durationSeconds).toBeUndefined();
  });

  test("threads the probed duration and HDR flag through", () => {
    const finalized = finalizeResolved(
      SPLIT_VIDEO,
      { ...withVideo, hdr: true },
      undefined,
    );
    expect(finalized.durationSeconds).toBe(1800);
    expect(finalized.hdr).toBe(true);
  });

  test("leaves hdr unset for an SDR source rather than writing false", () => {
    expect(
      finalizeResolved(SPLIT_VIDEO, withVideo, undefined).hdr,
    ).toBeUndefined();
  });

  test("never promotes a music item to video, even on a probe that found a picture", () => {
    const music: ResolvedSource = {
      title: "A Song",
      ffmpegInput: "https://cdn.invalid/audio",
      mediaKind: "music",
      chapters: [],
    };
    expect(finalizeResolved(music, withVideo, undefined).mediaKind).toBe(
      "music",
    );
  });

  test("still threads duration onto a music item it downgraded", () => {
    const finalized = finalizeResolved(SPLIT_VIDEO, noVideo, undefined);
    expect(finalized.durationSeconds).toBe(1800);
  });
});
