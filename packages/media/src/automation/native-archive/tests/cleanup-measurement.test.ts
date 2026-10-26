import path from "node:path";
import { tmpdir } from "node:os";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import { createDatabase } from "#infrastructure/database.ts";
import {
  measureArchiveContent,
  readArchiveManifest,
} from "#automation/native-archive/cleanup/content.ts";
import type { ArchiveFileContext } from "#automation/native-archive/execution.ts";

const directories: string[] = [];
const db = createDatabase(
  "postgresql://127.0.0.1:1/unused_archive_measurement",
);
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
  await db.$disconnect();
});

async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "archive-measurement-")),
  );
  directories.push(directory);
  // Each root is explicit, disjoint, and local; the database is never queried by these readers.
  const movies = {
    library: path.join(directory, "movies"),
    control: path.join(directory, "movies-control"),
    downloads: path.join(directory, "downloads-movies"),
  };
  const tv = {
    library: path.join(directory, "tv"),
    control: path.join(directory, "tv-control"),
    downloads: path.join(directory, "downloads-tv"),
  };
  for (const root of [...Object.values(movies), ...Object.values(tv)])
    await mkdir(root);
  const filename = path.join(movies.library, "video.mkv");
  await writeFile(filename, "original content");
  let active = true,
    hashing = 0;
  const expired = new Error("Original Archive measurement expired");
  const assertActive = () => {
    if (!active) throw expired;
  };
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const context: ArchiveFileContext = {
    workerPodUid: "measurement-only",
    execution: {
      observed,
      expiresAtMs: observed.wall + 60_000,
      signal: new AbortController().signal,
      assertActive,
      checkpoint: () => Promise.resolve(),
    },
    files: {
      db,
      roots: { movies, tv },
      plexAccess: () =>
        Promise.reject(new Error("No network access during measurement")),
      checkpoint: () => {
        hashing++;
        return Promise.resolve();
      },
      verifyStorageAuthority: () =>
        Promise.reject(new Error("No authority before full phase")),
      enabled: {
        acquisition: () => Promise.resolve(false),
        quarantine: () => Promise.resolve(false),
        purge: () => Promise.resolve(false),
      },
    },
  };
  return {
    context,
    movies,
    filename,
    expired,
    assertActive,
    expire: () => {
      active = false;
    },
    hashing: () => hashing,
  };
}

test("measurement cannot mutate or create control namespaces, and denied authority never seals", async () => {
  const f = await fixture();
  const measured = await measureArchiveContent(
    f.context,
    ["/data/movies/video.mkv", "/data/movies/absent.mkv"],
    f.assertActive,
  );
  expect("unlink" in measured).toBe(false);
  expect("content" in measured).toBe(false);
  expect(await measured.facts.digest(f.filename)).not.toBeNull();
  const denied = new Error("Full current owner authority denied");
  await expect(
    measured.seal({
      assertActive: f.assertActive,
      assertCurrent: () => Promise.reject(denied),
    }),
  ).rejects.toBe(denied);
  expect(await readdir(f.movies.control)).toEqual([]);
  await expect(
    readArchiveManifest(f.context, "movies", crypto.randomUUID()),
  ).rejects.toThrow("parent missing");
  expect(await readdir(f.movies.control)).toEqual([]);
  expect(await readFile(f.filename, "utf8")).toBe("original content");
});

test("all paths are checked before the first hash and a missing parent is never initialized", async () => {
  const f = await fixture();
  await expect(
    measureArchiveContent(
      f.context,
      ["/data/movies/video.mkv", "/data/movies/missing/video.mkv"],
      f.assertActive,
    ),
  ).rejects.toThrow("parent missing");
  expect(f.hashing()).toBe(0);
  expect(await readdir(f.movies.library)).toEqual(["video.mkv"]);
});

test.each(["bytes", "absence", "ancestor"] as const)(
  "%s drift cannot be sealed by later full authority",
  async (drift) => {
    const f = await fixture();
    const measured = await measureArchiveContent(
      f.context,
      ["/data/movies/video.mkv", "/data/movies/absent.mkv"],
      f.assertActive,
    );
    if (drift === "bytes") await writeFile(f.filename, "changed content!");
    if (drift === "absence")
      await writeFile(path.join(f.movies.library, "absent.mkv"), "foreign");
    if (drift === "ancestor") {
      await rename(f.movies.library, `${f.movies.library}-old`);
      await mkdir(f.movies.library);
      await writeFile(f.filename, "original content");
    }
    await expect(
      measured.seal({
        assertActive: f.assertActive,
        assertCurrent: () => Promise.resolve(),
      }),
    ).rejects.toThrow();
  },
);

test("sealing retains the original guard and never permits a second seal or expired unlink", async () => {
  const f = await fixture();
  const measured = await measureArchiveContent(
    f.context,
    ["/data/movies/video.mkv"],
    f.assertActive,
  );
  const proof = await measured.seal({
    assertActive: f.assertActive,
    assertCurrent: () => Promise.resolve(),
  });
  await expect(
    measured.seal({
      assertActive: f.assertActive,
      assertCurrent: () => Promise.resolve(),
    }),
  ).rejects.toThrow("already sealed");
  f.expire();
  await expect(proof.unlink(f.filename)).rejects.toBe(f.expired);
  expect(await readFile(f.filename, "utf8")).toBe("original content");
});
