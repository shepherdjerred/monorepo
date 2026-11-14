import { afterAll, beforeAll, expect } from "vitest";
import { lstat, readFile, rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import type { Database } from "#infrastructure/database.ts";

/** Per-file native adoption cluster and real video, with the caller's directory ownership. */
export function libraryAdoptionHarness() {
  let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
  let bytes: Uint8Array;
  const directories: string[] = [];
  beforeAll(async () => {
    cluster = await startMediaTestPostgres();
    bytes = await movieVideoFixture();
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  });
  return {
    get database() {
      return cluster.database;
    },
    get bytes() {
      return bytes;
    },
    directories,
  };
}

export async function expectNoLibraryRequests(db: Database, mediaId: string) {
  expect(await db.mediaRequest.count({ where: { mediaId } })).toBe(0);
}

export async function expectUnmovedLibraryVideo(
  target: string,
  bytes: Uint8Array,
  before: { ino: bigint; mtimeNs: bigint },
) {
  expect(await readFile(target)).toEqual(Buffer.from(bytes));
  const after = await lstat(target, { bigint: true });
  expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
}
