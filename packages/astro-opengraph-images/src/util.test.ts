import { expect, test } from "vitest";
import { getFilePath } from "./util.js";
import { tmpdir } from "os";
import { join, normalize } from "path";
import { mkdir, mkdtemp, writeFile } from "fs/promises";

test("getFilePath index", async () => {
  const tmpDir = await createTempDir();

  // change the current working directory to the temp dir
  process.chdir(tmpDir);

  // create a folder named blog inside the temp dir
  await writeFile(join(tmpDir, "index.html"), "");

  const result = getFilePath({ dir: "", page: "index/" });

  // change the current working directory back to the original
  process.chdir(__dirname);

  expect(normalize(result)).toBe(normalize("index.html"));
});

test("getFilePath 404", async () => {
  const tmpDir = await createTempDir();

  // change the current working directory to the temp dir
  process.chdir(tmpDir);

  // create a folder named blog inside the temp dir
  await writeFile(join(tmpDir, "404.html"), "");

  const result = getFilePath({ dir: "", page: "404/" });

  // change the current working directory back to the original
  process.chdir(__dirname);

  expect(normalize(result)).toBe(normalize("404.html"));
});

test("getFilePath blog", async () => {
  const tmpDir = await createTempDir();

  // change the current working directory to the temp dir
  process.chdir(tmpDir);

  // create a folder named blog inside the temp dir
  await mkdir(join(tmpDir, "blog"));
  await writeFile(join(tmpDir, "blog", "index.html"), "");

  const result = getFilePath({ dir: "", page: "blog/" });

  // change the current working directory back to the original
  process.chdir(__dirname);

  expect(normalize(result)).toBe(normalize("blog/index.html"));
});

// https://sdorra.dev/posts/2024-02-12-vitest-tmpdir
async function createTempDir() {
  const ostmpdir = tmpdir();
  const dir = join(ostmpdir, "unit-test-");
  return await mkdtemp(dir);
}
