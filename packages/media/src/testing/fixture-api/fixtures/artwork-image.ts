import { deflateSync } from "node:zlib";
import {
  ArtworkFileSchema,
  ArtworkSizeSchema,
  type ArtworkSize,
} from "#shared/artwork/proxy.ts";
import { sha256 } from "#testing/fixture-api/support.ts";
import { posterPath } from "./artwork.ts";

/**
 * Pictures for the artwork route, drawn here so the fixture client never
 * leaves its own origin: a two-colour wash whose hues come from the file
 * name, so a title keeps its picture and neighbours differ.
 */

/** Width and height served for each size: posters 2:3, backdrops 16:9. */
const DIMENSIONS: Record<ArtworkSize, readonly [number, number]> = {
  w185: [185, 278],
  w342: [342, 513],
  w500: [500, 750],
  w780: [780, 439],
  w1280: [1280, 720],
};

/**
 * The poster of this title is stored but cannot be fetched, as when TMDB is
 * unreachable and the proxy has no cached copy. It sorts last by title, so
 * the first page of the library never asks for it.
 */
export const UNREACHABLE_POSTER_TITLE = "Your Name.";
const UNREACHABLE_FILES: ReadonlySet<string> = new Set([
  posterPath(UNREACHABLE_POSTER_TITLE).slice(1),
]);

type Rgb = readonly [number, number, number];

/** A muted colour of the given hue: saturated enough to tell titles apart. */
function wash(hue: number, lightness: number): Rgb {
  const saturation = 0.3;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = lightness - chroma / 2;
  const [red, green, blue] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  return [
    Math.round((red + base) * 255),
    Math.round((green + base) * 255),
    Math.round((blue + base) * 255),
  ];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.byteLength);
  body.set(new TextEncoder().encode(type));
  body.set(data, 4);
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(body, 4);
  view.setUint32(8 + data.byteLength, Bun.hash.crc32(body));
  return out;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An 8-bit RGB PNG that fades from `top` to `bottom`. */
function gradientPng(
  [width, height]: readonly [number, number],
  top: Rgb,
  bottom: Rgb,
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // Bit depth 8, colour type 2 (RGB), default compression, filter, no interlace.
  header.set([8, 2, 0, 0, 0], 8);
  const stride = 1 + width * 3;
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const blend = row / (height - 1);
    const color = top.map((channel, index) =>
      Math.round(channel + ((bottom[index] ?? 0) - channel) * blend),
    );
    // Each scanline starts with its filter type; 0 is "none".
    for (let column = 0; column < width; column += 1)
      pixels.set(color, row * stride + 1 + column * 3);
  }
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(
    parts.reduce((length, part) => length + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.byteLength;
  }
  return png;
}

const drawn = new Map<string, Uint8Array<ArrayBuffer>>();

export type FixtureArtwork =
  | { status: 200; bytes: Uint8Array<ArrayBuffer> }
  | { status: 400 | 502; code: string; message: string };

/** What `GET /api/v1/artwork/:size/:file` answers in fixture mode. */
export function fixtureArtwork(size: string, file: string): FixtureArtwork {
  const parsedSize = ArtworkSizeSchema.safeParse(size);
  const parsedFile = ArtworkFileSchema.safeParse(file);
  if (!parsedSize.success || !parsedFile.success || !file.endsWith(".png")) {
    return {
      status: 400,
      code: "invalid_input",
      message: "The fixture API draws PNG artwork in the proxy's sizes only.",
    };
  }
  if (UNREACHABLE_FILES.has(file)) {
    return {
      status: 502,
      code: "artwork_unavailable",
      message: "The image is not cached and TMDB could not supply it.",
    };
  }
  const key = `${parsedSize.data}/${file}`;
  const cached = drawn.get(key);
  if (cached !== undefined) return { status: 200, bytes: cached };
  const hue = Number.parseInt(sha256(file).slice(0, 4), 16) % 360;
  const bytes = gradientPng(
    DIMENSIONS[parsedSize.data],
    wash(hue, 0.42),
    wash((hue + 40) % 360, 0.12),
  );
  drawn.set(key, bytes);
  return { status: 200, bytes };
}
