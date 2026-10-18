import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { ContentProof } from "./content-proof.ts";
import { FileOperations } from "./operations.ts";
import type { ContentPath } from "./operation-locks.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-content-paths-")),
  );
  directories.push(directory);
  const roots = {
    library: path.join(directory, "library"),
    control: path.join(directory, "control"),
    downloads: path.join(directory, "downloads"),
  };
  for (const root of Object.values(roots)) await mkdir(root);
  const source = path.join(roots.control, "quarantine/video");
  const target = path.join(roots.library, "movie.mkv");
  await writeFile(target, "synthetic video");
  const sha256 = createHash("sha256").update("synthetic video").digest("hex");
  await new FileOperations(roots, {
    authorize: () => Promise.resolve(),
  }).quarantine({
    operationId: "original",
    quarantineId: "video",
    libraryPath: "movie.mkv",
    sha256,
  });
  const content = new ContentProof();
  for (const filename of [source, target])
    await content.capture(filename, () => Promise.resolve());
  content.seal();
  const paths: ContentPath[] = [
    { root: "library", path: "movie.mkv" },
    { root: "control", path: "quarantine/video" },
  ];
  const files = new FileOperations(roots, {
    authorize: () => Promise.resolve(),
    contentProof: content,
  });
  const restore = {
    operationId: "restore",
    quarantineId: "video",
    libraryPath: "movie.mkv",
    sha256,
  };
  return { roots, files, content, paths, source, target, restore };
}

test("composes exact restore under present control and absent library proof locks", async () => {
  const f = await fixture();
  await f.files.withContentPaths(f.paths, () => f.files.restore(f.restore), [
    f.restore.operationId,
  ]);
  expect(await readFile(f.target, "utf8")).toBe("synthetic video");
  expect(await f.content.digest(f.source)).toBeNull();
});

test.each(["source", "destination", "ancestor"])(
  "rejects %s substitution before scoped mutation",
  async (substitution) => {
    const f = await fixture();
    if (substitution === "source") {
      await rename(f.source, `${f.source}.old`);
      await writeFile(f.source, "synthetic video");
    } else if (substitution === "destination")
      await writeFile(f.target, "synthetic video");
    else {
      await rename(f.roots.library, `${f.roots.library}.old`);
      await mkdir(f.roots.library);
    }
    let called = false;
    await expect(
      f.files.withContentPaths(f.paths, async () => {
        called = true;
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  },
);

test("does not expose an absolute path or nested/empty/duplicate scope bypass", async () => {
  const f = await fixture();
  await expect(
    f.files.withContentPaths([], () => Promise.resolve()),
  ).rejects.toThrow("empty or duplicate");
  await expect(
    f.files.withContentPaths([...f.paths, ...f.paths], () => Promise.resolve()),
  ).rejects.toThrow("empty or duplicate");
  await expect(
    f.files.withContentPaths([{ root: "control", path: f.source }], () =>
      Promise.resolve(),
    ),
  ).rejects.toThrow("Invalid relative");
  await expect(
    f.files.withContentPaths(
      [{ root: "control", path: "../library/movie.mkv" }],
      () => Promise.resolve(),
    ),
  ).rejects.toThrow("Invalid relative");
  await f.files.withContentPaths(f.paths, async () => {
    await expect(
      f.files.withContentPaths(f.paths, () => Promise.resolve()),
    ).rejects.toThrow("Nested");
    const other = new FileOperations(f.roots, {
      authorize: () => Promise.resolve(),
      contentProof: f.content,
    });
    await expect(other.restore(f.restore)).rejects.toThrow("lock busy");
    await expect(f.files.restore(f.restore)).rejects.toThrow("unscoped");
  });
});

test("checks proof identity again after awaited callback work", async () => {
  const f = await fixture();
  await expect(
    f.files.withContentPaths(f.paths, async () => {
      await writeFile(f.target, "foreign late write");
    }),
  ).rejects.toThrow("Previously absent");
});
