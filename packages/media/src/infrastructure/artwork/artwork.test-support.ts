import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { TmdbImageClient } from "#integrations/tmdb-images.ts";
import { ArtworkDiskCache } from "./cache.ts";
import { ArtworkProxy } from "./proxy.ts";
import { ArtworkTelemetry, type ArtworkLog } from "./telemetry.ts";

export const POSTER = "1E5baAaEse26fej7uHcjOgEE2t2.jpg";

/** A valid file name that differs for every index. */
export function posterName(index: number): string {
  return `${String(index).padStart(8, "0")}.jpg`;
}

function image(signature: number[], length: number, fill: number) {
  const bytes = new Uint8Array(length).fill(fill);
  bytes.set(signature.slice(0, length));
  return bytes;
}

export function jpeg(length = 32, fill = 7): Uint8Array<ArrayBuffer> {
  return image([0xff, 0xd8, 0xff, 0xe0], length, fill);
}

export function png(length = 32): Uint8Array<ArrayBuffer> {
  return image([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], length, 7);
}

const roots: string[] = [];

/** Register with `afterEach`. */
export async function removeArtworkFixtures(): Promise<void> {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export async function artworkRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "media-artwork-"));
  roots.push(root);
  return root;
}

/**
 * A proxy over a temporary directory. `upstream` defaults to a stub that
 * answers every request with a small JPEG.
 */
export async function artworkFixture(
  options: {
    maximumBytes?: number;
    root?: string;
    upstream?: Pick<TmdbImageClient, "image">;
  } = {},
) {
  const root = options.root ?? (await artworkRoot());
  const log = vi.fn<ArtworkLog>();
  const telemetry = new ArtworkTelemetry(log);
  const cache = await ArtworkDiskCache.open(
    root,
    options.maximumBytes ?? 1024 * 1024,
    telemetry,
  );
  const fetched = vi.fn<TmdbImageClient["image"]>(() =>
    Promise.resolve({
      status: "found",
      bytes: jpeg(),
      contentType: "image/jpeg",
    }),
  );
  const clock = { now: 1_000_000 };
  const proxy = new ArtworkProxy(
    cache,
    options.upstream ?? { image: fetched },
    telemetry,
    () => clock.now,
  );
  return { root, log, cache, fetched, clock, proxy };
}
