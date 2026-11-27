import { writeFile } from "node:fs/promises";

/**
 * Minimal PGS (`.sup`, Blu-ray presentation graphics) writer for integration fixtures. ffmpeg has
 * no PGS encoder, and it only converts bitmap subtitles from other bitmap subtitles, so a real
 * Blu-ray-style image track has to be authored by hand. Each cue is an opaque white rectangle — the
 * tests only need pixels that change while a cue is on screen — shown by an epoch-start display
 * set and cleared by an empty composition at its end time.
 */
export type PgsCue = {
  /** Display window, in seconds of the subtitle stream's clock. */
  readonly start: number;
  readonly end: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const PCS = 0x16;
const WDS = 0x17;
const PDS = 0x14;
const ODS = 0x15;
const END = 0x80;

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function segment(
  pts: number,
  type: number,
  payload: readonly number[],
): Buffer {
  const header = Buffer.alloc(13);
  header.write("PG", 0, "ascii");
  header.writeUInt32BE(Math.round(pts * 90_000), 2);
  header.writeUInt32BE(0, 6);
  header.writeUInt8(type, 10);
  header.writeUInt16BE(payload.length, 11);
  return Buffer.concat([header, Buffer.from(payload)]);
}

/** PGS run-length encoding of a rectangle filled with palette entry 1 (≤ 16383 px per line). */
function solidRle(width: number, height: number): number[] {
  const line =
    width < 64
      ? [0x00, 0x80 | width, 0x01]
      : [0x00, 0xc0 | (width >> 8), width & 0xff, 0x01];
  return Array.from({ length: height }, () => [...line, 0x00, 0x00]).flat();
}

export async function writePgsSup(
  file: string,
  canvas: { readonly width: number; readonly height: number },
  cues: readonly PgsCue[],
): Promise<void> {
  const segments: Buffer[] = [];
  let composition = 0;
  for (const cue of cues) {
    const window = [
      0x01,
      0x00,
      ...u16(cue.x),
      ...u16(cue.y),
      ...u16(cue.width),
      ...u16(cue.height),
    ];
    const rle = solidRle(cue.width, cue.height);
    const objectLength = rle.length + 4;
    segments.push(
      segment(cue.start, PCS, [
        ...u16(canvas.width),
        ...u16(canvas.height),
        0x10,
        ...u16(composition++),
        0x80, // epoch start
        0x00,
        0x00,
        0x01,
        ...u16(0),
        0x00,
        0x00,
        ...u16(cue.x),
        ...u16(cue.y),
      ]),
      segment(cue.start, WDS, window),
      // Palette: 0 transparent, 1 opaque white (Y 235, Cr/Cb 128).
      segment(
        cue.start,
        PDS,
        [0x00, 0x00, 0x00, 16, 128, 128, 0x00, 0x01, 235, 128, 128, 0xff],
      ),
      segment(cue.start, ODS, [
        ...u16(0),
        0x00,
        0xc0, // first and last fragment
        (objectLength >> 16) & 0xff,
        (objectLength >> 8) & 0xff,
        objectLength & 0xff,
        ...u16(cue.width),
        ...u16(cue.height),
        ...rle,
      ]),
      segment(cue.start, END, []),
      // Clear: a normal composition with no objects.
      segment(cue.end, PCS, [
        ...u16(canvas.width),
        ...u16(canvas.height),
        0x10,
        ...u16(composition++),
        0x00,
        0x00,
        0x00,
        0x00,
      ]),
      segment(cue.end, WDS, window),
      segment(cue.end, END, []),
    );
  }
  await writeFile(file, Buffer.concat(segments));
}
