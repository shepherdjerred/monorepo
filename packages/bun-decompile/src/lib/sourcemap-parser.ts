import { spawn } from "bun";
import { basename } from "node:path";
import type { StringPointer } from "./types.ts";

/** Parsed source file from a sourcemap */
export type SourceFile = {
  /** Original file name (e.g., "utils.ts") */
  name: string;
  /** Original source content (decompressed) */
  content: string;
};

/** Parsed Bun SerializedSourceMap */
export type ParsedSourceMap = {
  /** Number of source files */
  sourceCount: number;
  /** VLQ-encoded mappings */
  mappings: string;
  /** Original source files with decompressed content */
  sources: SourceFile[];
};

/** Read a u32 from buffer (little-endian) */
function readU32(buffer: Uint8Array, offset: number): number {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  return view.getUint32(offset, true);
}

/** Read a StringPointer from buffer */
function readStringPointer(buffer: Uint8Array, offset: number): StringPointer {
  return {
    offset: readU32(buffer, offset),
    length: readU32(buffer, offset + 4),
  };
}

/** Decompress ZSTD data using the zstd CLI tool */
async function decompressZstd(compressed: Uint8Array): Promise<string> {
  // Write compressed data to a temp file and decompress
  const tempIn = `/tmp/bun-decompile-${String(Date.now())}-${Math.random().toString(36).slice(2)}.zst`;
  const tempOut = tempIn.replace(".zst", ".txt");

  try {
    await Bun.write(tempIn, compressed);

    const proc = spawn({
      cmd: ["zstd", "-d", tempIn, "-o", tempOut],
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`ZSTD decompression failed: ${stderr}`);
    }

    const output = await Bun.file(tempOut).text();
    return output;
  } finally {
    // Cleanup temp files
    try {
      if (await Bun.file(tempIn).exists()) {
        await Bun.write(tempIn, "");
      }
      if (await Bun.file(tempOut).exists()) {
        await Bun.write(tempOut, "");
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Parse a Bun SerializedSourceMap and extract original sources
 *
 * Format:
 *   u32 source_count
 *   u32 mappings_length
 *   StringPointer[source_count] names
 *   StringPointer[source_count] contents (ZSTD compressed)
 *   VLQ mappings (mappings_length bytes)
 *   String payload (names + compressed sources)
 */
export async function parseSourceMap(
  data: Uint8Array,
): Promise<ParsedSourceMap | null> {
  if (data.length < 8) {
    return null;
  }

  try {
    const sourceCount = readU32(data, 0);
    const mappingsLength = readU32(data, 4);

    // Sanity checks
    if (sourceCount === 0 || sourceCount > 10_000) {
      return null;
    }
    if (mappingsLength === 0 || mappingsLength > data.length) {
      return null;
    }

    // Read name pointers
    const namesStart = 8;
    const namePointers: StringPointer[] = [];
    for (let i = 0; i < sourceCount; i++) {
      namePointers.push(readStringPointer(data, namesStart + i * 8));
    }

    // Read content pointers (after name pointers)
    const contentsStart = namesStart + sourceCount * 8;
    const contentPointers: StringPointer[] = [];
    for (let i = 0; i < sourceCount; i++) {
      contentPointers.push(readStringPointer(data, contentsStart + i * 8));
    }

    // VLQ mappings start after all pointers
    const mappingsStart = contentsStart + sourceCount * 8;
    const mappings = new TextDecoder().decode(
      data.slice(mappingsStart, mappingsStart + mappingsLength),
    );

    // Extract and decompress sources
    const sources: SourceFile[] = [];
    for (let i = 0; i < sourceCount; i++) {
      const namePtr = namePointers[i];
      const contentPtr = contentPointers[i];

      if (
        namePtr === undefined ||
        contentPtr === undefined ||
        namePtr.offset + namePtr.length > data.length ||
        contentPtr.offset + contentPtr.length > data.length
      ) {
        continue;
      }

      let name = new TextDecoder().decode(
        data.slice(namePtr.offset, namePtr.offset + namePtr.length),
      );
      // Normalize paths with .. to just the basename
      if (name.includes("..")) {
        name = basename(name);
      }

      // Decompress ZSTD content
      const compressed = data.slice(
        contentPtr.offset,
        contentPtr.offset + contentPtr.length,
      );

      // Verify ZSTD magic (0x28 0xB5 0x2F 0xFD)
      if (
        compressed.length < 4 ||
        compressed[0] !== 0x28 ||
        compressed[1] !== 0xb5 ||
        compressed[2] !== 0x2f ||
        compressed[3] !== 0xfd
      ) {
        // Not ZSTD compressed, try as plain text
        sources.push({
          name,
          content: new TextDecoder().decode(compressed),
        });
        continue;
      }

      const content = await decompressZstd(compressed);
      sources.push({ name, content });
    }

    return {
      sourceCount,
      mappings,
      sources,
    };
  } catch {
    return null;
  }
}
