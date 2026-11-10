import { afterEach, beforeEach, expect, test } from "vitest";
import {
  chmod,
  link,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareCodexOutputSchema } from "./output-schema.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "codex-schema-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function schema() {
  const directory = await mkdtemp(path.join(root, "codex-output-schema-"));
  const file = path.join(directory, "schema.json");
  await writeFile(file, '{"type":"object"}');
  return { directory, file };
}
const prepare = (args: string[]) => prepareCodexOutputSchema(args, 1001, root);

test("does nothing when the SDK has no structured output schema", async () => {
  await prepare(["exec", "--json"]);
});
test("rejects paths outside the SDK-owned temporary directory", async () => {
  const { file } = await schema();
  await expect(
    prepareCodexOutputSchema(["--output-schema", file], 1001, os.tmpdir()),
  ).rejects.toThrow("SDK temporary directory");
});
test("rejects missing and duplicate schema arguments", async () => {
  const { file } = await schema();
  await expect(prepare(["--output-schema"])).rejects.toThrow("one SDK");
  await expect(
    prepare(["--output-schema", file, "--output-schema", file]),
  ).rejects.toThrow("one SDK");
});
test("rejects a linked schema directory", async () => {
  const { directory } = await schema();
  const alias = path.join(root, "codex-output-schema-linked");
  await symlink(directory, alias);
  await expect(
    prepare(["--output-schema", path.join(alias, "schema.json")]),
  ).rejects.toThrow();
});
test("rejects a linked schema file without transferring its target", async () => {
  const directory = await mkdtemp(path.join(root, "codex-output-schema-"));
  const target = path.join(root, "private.json");
  await writeFile(target, "private");
  const file = path.join(directory, "schema.json");
  await symlink(target, file);
  await expect(prepare(["--output-schema", file])).rejects.toThrow();
  expect(await Bun.file(target).text()).toBe("private");
});
test("rejects hardlinks and non-regular schema files", async () => {
  const { file } = await schema();
  await link(file, path.join(root, "other.json"));
  await expect(prepare(["--output-schema", file])).rejects.toThrow(
    "owned regular file",
  );
  await rm(file);
  await mkdir(file);
  await expect(prepare(["--output-schema", file])).rejects.toThrow(
    "owned regular file",
  );
});
test("rejects a schema directory with unrelated files", async () => {
  const { directory, file } = await schema();
  await writeFile(path.join(directory, "unrelated"), "private");
  await expect(prepare(["--output-schema", file])).rejects.toThrow(
    "unexpected contents",
  );
});
test("rejects a directory accessible to other users", async () => {
  const { directory, file } = await schema();
  await chmod(directory, 0o755);
  await expect(prepare(["--output-schema", file])).rejects.toThrow(
    "privately owned",
  );
});
