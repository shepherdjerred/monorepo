import path from "node:path";
import { z } from "zod";
import { parseJson } from "@shepherdjerred/streambot/util/errors.ts";

/**
 * Pure subtitle-format helpers: which codecs burn through libass (text) or as an overlay (image),
 * which text formats keep their styling (ASS/SSA), the font attachments an ASS track needs, and
 * the ffmpeg arguments that extract a text track with them. No I/O — unit-testable.
 */

/** ffmpeg subtitle codecs libass can render (burnable). */
const TEXT_SUBTITLE_CODECS = new Set([
  "subrip",
  "srt",
  "ass",
  "ssa",
  "mov_text",
  "webvtt",
  "vtt",
  "text",
]);
/** Image/bitmap subtitle codecs: libass cannot render them, so they are burned with `overlay`. */
const IMAGE_SUBTITLE_CODECS = new Set([
  "hdmv_pgs_subtitle",
  "pgssub",
  "dvd_subtitle",
  "dvdsub",
  "dvb_subtitle",
  "dvbsub",
  "xsub",
]);

export type SubtitleClass = "text" | "image" | "other";

/** Classify a subtitle codec as libass text, overlay image, or unknown (never burned). */
export function classifySubtitleCodec(codec: string): SubtitleClass {
  const c = codec.toLowerCase();
  if (TEXT_SUBTITLE_CODECS.has(c)) return "text";
  return IMAGE_SUBTITLE_CODECS.has(c) ? "image" : "other";
}

/**
 * ASS/SSA tracks keep their styling only as `.ass`: flattening them to SRT drops positioning,
 * signs, karaoke and fonts. Everything else text-based is extracted as SRT.
 */
export function isAssSubtitleCodec(codec: string): boolean {
  const c = codec.toLowerCase();
  return c === "ass" || c === "ssa";
}

const SUBTITLE_FORMAT_LABELS: Readonly<Record<string, string>> = {
  subrip: "SRT",
  srt: "SRT",
  ass: "ASS",
  ssa: "SSA",
  mov_text: "text",
  webvtt: "VTT",
  vtt: "VTT",
  text: "text",
  hdmv_pgs_subtitle: "PGS",
  pgssub: "PGS",
  dvd_subtitle: "VobSub",
  dvdsub: "VobSub",
  dvb_subtitle: "DVB",
  dvbsub: "DVB",
  xsub: "XSUB",
};

/** Short human format name for a subtitle codec (picker labels): `hdmv_pgs_subtitle` → `PGS`. */
export function subtitleFormatLabel(codec: string): string {
  return SUBTITLE_FORMAT_LABELS[codec.toLowerCase()] ?? codec;
}

const FfprobeAttachmentSchema = z.object({
  codec_name: z.string().optional(),
  tags: z
    .object({
      filename: z.string().optional(),
      mimetype: z.string().optional(),
    })
    .optional(),
});
const FfprobeAttachmentsSchema = z.object({
  streams: z.array(FfprobeAttachmentSchema).default([]),
});

/** File extensions FreeType loads as fonts; used for the controlled name each font is dumped to. */
const FONT_EXTENSIONS = new Set(["ttf", "otf", "ttc", "otc"]);

/** A font attached to the source (MKV), by attachment-relative index for `-dump_attachment:t:<i>`. */
export type FontAttachment = {
  readonly attachmentIndex: number;
  /**
   * Controlled file name to dump it as (`font-<i>.<ext>`). The attachment's own `filename` tag is
   * never used as a path: it comes from the media file and could contain `../`.
   */
  readonly fileName: string;
};

/**
 * Parse `ffprobe -select_streams t -show_streams -of json` into the attachments that are fonts —
 * by codec (`ttf`/`otf`), MIME type (`application/x-truetype-font`, `font/otf`, …) or file
 * extension, since muxers disagree on which of these they set.
 */
export function parseFontAttachments(stdout: string): FontAttachment[] {
  const { streams } = FfprobeAttachmentsSchema.parse(parseJson(stdout));
  return streams.flatMap((stream, attachmentIndex): FontAttachment[] => {
    const codec = stream.codec_name?.toLowerCase() ?? "";
    const mimetype = stream.tags?.mimetype?.toLowerCase() ?? "";
    const ext = path
      .extname(stream.tags?.filename ?? "")
      .slice(1)
      .toLowerCase();
    const isFont =
      codec === "ttf" ||
      codec === "otf" ||
      /font|truetype|opentype|sfnt/u.test(mimetype) ||
      FONT_EXTENSIONS.has(ext);
    if (!isFont) return [];
    const safeExt = FONT_EXTENSIONS.has(ext)
      ? ext
      : codec === "otf"
        ? "otf"
        : "ttf";
    return [
      {
        attachmentIndex,
        fileName: `font-${String(attachmentIndex)}.${safeExt}`,
      },
    ];
  });
}

/**
 * ffmpeg arguments (after the binary) that extract one embedded text track to `dest` in a single
 * demux pass. An ASS track keeps its styling: `ass` is stream-copied (`ssa` is re-muxed through
 * the ASS encoder, which keeps its markup) into the `ass` muxer, and every font in `fonts` is
 * dumped alongside it. Any other text track is converted to SRT. The muxer is pinned with `-f`, so
 * the staging file name can never change the output format.
 */
export function embeddedTrackExtractArgs(input: {
  readonly filePath: string;
  readonly subtitleIndex: number;
  readonly codec: string;
  readonly dest: string;
  readonly fonts: readonly {
    readonly attachmentIndex: number;
    readonly path: string;
  }[];
}): string[] {
  const ass = isAssSubtitleCodec(input.codec);
  const codec = input.codec.toLowerCase() === "ass" ? "copy" : "ass";
  return [
    "-y",
    ...(ass
      ? input.fonts.flatMap((font) => [
          `-dump_attachment:t:${String(font.attachmentIndex)}`,
          font.path,
        ])
      : []),
    "-i",
    input.filePath,
    "-map",
    `0:s:${String(input.subtitleIndex)}`,
    "-c:s",
    ass ? codec : "srt",
    "-f",
    ass ? "ass" : "srt",
    input.dest,
  ];
}
