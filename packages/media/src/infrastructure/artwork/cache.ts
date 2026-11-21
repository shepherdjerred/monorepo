import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  ArtworkFileSchema,
  ArtworkSizeSchema,
  artworkContentType,
  hasArtworkSignature,
  type ArtworkSize,
} from "#shared/household/artwork.ts";
import type { ArtworkTelemetry } from "./telemetry.ts";

/** Never matches `ArtworkFileSchema`, so a reader cannot be handed one. */
const TEMPORARY_PREFIX = ".writing-";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Artwork bytes on a persistent volume, laid out as `<root>/<size>/<file>`.
 *
 * TMDB file names are content-addressed, so an entry never expires; the only
 * removal is least-recently-used eviction once the stored bytes pass the cap.
 * The index (key to byte length, oldest use first) lives in memory and is
 * built from one directory scan at first use, ordered by modification time
 * because recency is not written to disk: a hit only reorders the index.
 * Nothing here runs on a timer.
 */
export class ArtworkDiskCache {
  private index: Promise<Map<string, number>> | null = null;
  private entries: Map<string, number> | null = null;
  private bytes = 0;

  private constructor(
    private readonly root: string,
    private readonly maximumBytes: number,
    private readonly telemetry: ArtworkTelemetry,
  ) {}

  /**
   * Requires `root` to be an existing, writable directory. The volume is
   * deployment wiring, so its absence stops the server instead of moving the
   * cache somewhere that does not survive a restart.
   */
  static async open(
    root: string,
    maximumBytes: number,
    telemetry: ArtworkTelemetry,
  ): Promise<ArtworkDiskCache> {
    const probe = path.join(root, `${TEMPORARY_PREFIX}${crypto.randomUUID()}`);
    try {
      const directory = await stat(root);
      if (!directory.isDirectory()) throw new Error("Not a directory");
      const handle = await open(probe, "wx");
      await handle.close();
      await rm(probe);
    } catch (error) {
      throw new Error(
        `Artwork cache directory ${root} is missing or not writable`,
        { cause: error },
      );
    }
    return new ArtworkDiskCache(root, maximumBytes, telemetry);
  }

  /** Entry count and stored bytes, or `null` before the first scan. */
  stored(): { entries: number; bytes: number } | null {
    return this.entries === null
      ? null
      : { entries: this.entries.size, bytes: this.bytes };
  }

  /**
   * The cached bytes, or `null` when the caller has to fetch. An entry whose
   * file is gone, empty, or does not start with its type's signature is
   * reported, removed and treated as absent; it is never served.
   */
  async read(
    size: ArtworkSize,
    file: string,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    const key = `${size}/${file}`;
    const entries = await this.load();
    if (!entries.has(key)) return null;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await Bun.file(this.location(size, file)).bytes();
    } catch (error) {
      if (!isMissing(error)) throw error;
      this.forget(entries, key);
      this.telemetry.corrupt(key, "missing");
      return null;
    }
    if (!hasArtworkSignature(artworkContentType(file), bytes)) {
      this.forget(entries, key);
      await rm(this.location(size, file), { force: true });
      this.telemetry.corrupt(
        key,
        bytes.byteLength === 0 ? "empty" : "signature",
      );
      return null;
    }
    // An eviction during the read has already dropped the entry; leave it out.
    const length = entries.get(key);
    if (length !== undefined) {
      entries.delete(key);
      entries.set(key, length);
    }
    return bytes;
  }

  /**
   * Stores validated bytes, then evicts down to the cap. The bytes are synced
   * to a temporary file in the same directory and renamed into place, so a
   * reader or a crash never observes a partial file under the final name.
   */
  async write(size: ArtworkSize, file: string, bytes: Uint8Array) {
    const key = `${size}/${file}`;
    const entries = await this.load();
    const target = this.location(size, file);
    const temporary = path.join(
      path.dirname(target),
      `${TEMPORARY_PREFIX}${file}.${crypto.randomUUID()}`,
    );
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const handle = await open(temporary, "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    this.forget(entries, key);
    entries.set(key, bytes.byteLength);
    this.bytes += bytes.byteLength;
    await this.evict(entries, key);
  }

  private location(size: ArtworkSize, file: string): string {
    return path.join(
      this.root,
      ArtworkSizeSchema.parse(size),
      ArtworkFileSchema.parse(file),
    );
  }

  private forget(entries: Map<string, number>, key: string): void {
    this.bytes -= entries.get(key) ?? 0;
    entries.delete(key);
  }

  /** Picks victims synchronously so concurrent writes never count one twice. */
  private async evict(entries: Map<string, number>, keep: string) {
    const victims: string[] = [];
    let freed = 0;
    for (const [key, length] of entries) {
      if (this.bytes <= this.maximumBytes) break;
      if (key === keep) continue;
      this.forget(entries, key);
      victims.push(key);
      freed += length;
    }
    if (victims.length === 0) return;
    await Promise.all(
      victims.map((key) => rm(path.join(this.root, key), { force: true })),
    );
    this.telemetry.evicted(victims.length, freed);
  }

  private load(): Promise<Map<string, number>> {
    this.index ??= this.scan();
    return this.index;
  }

  private async scan(): Promise<Map<string, number>> {
    try {
      const found: { key: string; length: number; modified: number }[] = [];
      for (const size of ArtworkSizeSchema.options) {
        for (const name of await this.list(size)) {
          const target = path.join(this.root, size, name);
          if (name.startsWith(TEMPORARY_PREFIX)) {
            // Left behind by a write that never reached its rename.
            await rm(target, { force: true });
          } else if (ArtworkFileSchema.safeParse(name).success) {
            const { size: length, mtimeMs } = await stat(target);
            found.push({ key: `${size}/${name}`, length, modified: mtimeMs });
          }
        }
      }
      found.sort((left, right) => left.modified - right.modified);
      const entries = new Map(found.map(({ key, length }) => [key, length]));
      this.bytes = found.reduce((total, { length }) => total + length, 0);
      this.entries = entries;
      return entries;
    } catch (error) {
      this.index = null;
      throw error;
    }
  }

  private async list(size: ArtworkSize): Promise<string[]> {
    try {
      return await readdir(path.join(this.root, size));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
}
