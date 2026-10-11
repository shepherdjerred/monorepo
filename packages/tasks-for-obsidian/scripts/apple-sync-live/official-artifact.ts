import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { PendingCheckpoint, digest } from "./model";

export function validateOfficialScreenshot(bytes: Uint8Array) {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.length < 45 ||
    bytes.length > 20 * 1024 * 1024 ||
    !png.every((byte, index) => bytes[index] === byte)
  )
    throw new Error("Official UI evidence must be a bounded PNG screenshot");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressed: Uint8Array[] = [];
  let dimensions: { width: number; height: number } | undefined;
  let finished = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw new Error("Truncated official UI screenshot");
    const kind = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    if (
      Bun.hash.crc32(bytes.subarray(offset + 4, end - 4)) !==
      view.getUint32(end - 4)
    )
      throw new Error("Corrupt official UI screenshot");
    if (offset === 8) {
      dimensions = headerDimensions(kind, length, view, offset);
    }
    if (kind === "IDAT") compressed.push(bytes.subarray(offset + 8, end - 4));
    if (kind === "IEND") {
      finished = length === 0 && end === bytes.length;
      break;
    }
    offset = end;
  }
  const validated = requireDimensions(dimensions, finished, compressed.length);
  const image = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: 128 * 1024 * 1024,
  });
  if (image.length < validated.height)
    throw new Error("Invalid PNG image payload");
  return validated;
}

function headerDimensions(
  kind: string,
  length: number,
  view: DataView,
  offset: number,
) {
  if (kind !== "IHDR" || length !== 13)
    throw new Error("Invalid PNG image header");
  return {
    width: view.getUint32(offset + 8),
    height: view.getUint32(offset + 12),
  };
}

function requireDimensions(
  dimensions: { width: number; height: number } | undefined,
  finished: boolean,
  chunks: number,
) {
  if (
    !finished ||
    chunks === 0 ||
    dimensions === undefined ||
    dimensions.width < 320 ||
    dimensions.height < 320 ||
    dimensions.width * dimensions.height > 25_000_000
  )
    throw new Error(
      "Official UI evidence requires a complete readable screenshot",
    );
  return dimensions;
}

export async function readOfficialArtifact(directory: string, step: string) {
  if (!["create", "edit", "complete", "uncomplete"].includes(step))
    throw new Error("Invalid official UI step");
  const filename = path.join(directory, `${step}.png`);
  if (!(await Bun.file(filename).exists()))
    throw new PendingCheckpoint(
      `Save a synthetic-only official TaskNotes screenshot at ${filename}; exclude credentials and unrelated vaults.`,
    );
  if (
    (await realpath(directory)) !== directory ||
    (await realpath(filename)) !== filename
  )
    throw new Error(
      "Official UI evidence must remain in its owned artifact directory",
    );
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
    throw new Error("Invalid official UI artifact file");
  const bytes = await readFile(filename);
  return {
    filename,
    sha256: digest(bytes),
    size: bytes.length,
    ...validateOfficialScreenshot(bytes),
  };
}
