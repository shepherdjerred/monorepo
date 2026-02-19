import { expect, test } from "vitest";
import { getFilePath } from "./util.ts";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

test("getFilePath index", async () => {
  const tmpDir = await createTempDir();

  // change the current working directory to the temp dir
  process.chdir(tmpDir);

  // create a folder named blog inside the temp dir
  await writeFile(path.join(tmpDir, "index.html"), "");

  const result = await getFilePath({ dir: "", page: "index/" });

  // change the current working directory back to the original
  process.chdir(import.meta.dirname);

  expect(path.normalize(result)).toBe(path.normalize("index.html"));
});

test("getFilePath 404", async () => {
  const tmpDir = await createTempDir();

  // change the current working directory to the temp dir
  process.chdir(tmpDir);

  // create a folder named blog inside the temp dir
  await writeFile(path.join(tmpDir, "404.html"), "");

  const result = await getFilePath({ dir: "", page: "404/" });

  // change the current working directory back to the original
  process.chdir(import.meta.dirname);

  expect(path.normalize(result)).toBe(path.normalize("404.html"));
});

test("getFilePath blog", async () => {
  const tmpDir = await createTempDir();

  // change the current working directory to the temp dir
  process.chdir(tmpDir);

  // create a folder named blog inside the temp dir
  await mkdir(path.join(tmpDir, "blog"));
  await writeFile(path.join(tmpDir, "blog", "index.html"), "");

  const result = await getFilePath({ dir: "", page: "blog/" });

  // change the current working directory back to the original
  process.chdir(import.meta.dirname);

  expect(path.normalize(result)).toBe(path.normalize("blog/index.html"));
});

// https://sdorra.dev/posts/2024-02-12-vitest-tmpdir
async function createTempDir() {
  const ostmpdir = tmpdir();
  const dir = path.join(ostmpdir, "unit-test-");
  return await mkdtemp(dir);
}
