import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CorpusManifestSchema, CorpusInputSchema } from "./contract.ts";
import { loadCorpus } from "./load.ts";
import manifest from "./seeds/manifest.json";
import movie from "./seeds/movie.json";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "media-corpus-"));
  directories.push(root);
  const value = CorpusManifestSchema.parse(manifest);
  const entry = value.cases[0];
  if (entry === undefined) throw new Error("Authored case missing");
  value.cases = [entry];
  for (const artifact of [entry.input, entry.labels, entry.profile.artifact])
    await writeFile(
      path.join(root, artifact.path),
      await readFile(new URL(`seeds/${artifact.path}`, import.meta.url)),
    );
  const filename = path.join(root, "manifest.json");
  const save = () => writeFile(filename, JSON.stringify(value));
  await save();
  return { root, value, entry, filename, save };
}

test("loads only SHA256-bound explicit local artifacts and keeps labels outside production inputs", async () => {
  const loaded = await loadCorpus(
    fileURLToPath(new URL("seeds/manifest.json", import.meta.url)),
  );
  const entry = loaded.manifest.cases[0];
  if (entry === undefined) throw new Error("Authored case missing");
  const item = await loaded.readCase(entry);
  expect(item.input).not.toHaveProperty("labels");
  expect(item.input).not.toHaveProperty("identityConfirmed");
  expect(
    item.labels.candidates.some(
      (candidate) => candidate.disposition === "accept",
    ),
  ).toBe(true);
  expect(() =>
    CorpusInputSchema.parse({ ...movie, identityConfirmed: true }),
  ).toThrow();
});

test("literal artifact substitution rejects before replay even when JSON remains valid", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, f.entry.input.path),
    `${JSON.stringify(movie)}\n`,
  );
  const loaded = await loadCorpus(f.filename);
  await expect(loaded.readCase(f.entry)).rejects.toThrow(
    "Corpus artifact literal SHA256 changed",
  );
});

test("relative traversal and a symlink outside the manifest directory cannot supply an artifact", async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "media-corpus-outside-"));
  directories.push(outside);
  const bytes = await readFile(path.join(f.root, f.entry.input.path));
  await writeFile(path.join(outside, "input.json"), bytes);
  f.entry.input.path = "../input.json";
  await f.save();
  await expect(loadCorpus(f.filename)).rejects.toThrow();
  f.entry.input.path = "linked.json";
  await symlink(
    path.join(outside, "input.json"),
    path.join(f.root, "linked.json"),
  );
  await f.save();
  const loaded = await loadCorpus(f.filename);
  await expect(loaded.readCase(f.entry)).rejects.toThrow(
    "Corpus artifact escaped its explicit manifest directory",
  );
});

test("a separately hashed but incomplete label set is rejected rather than dropping candidates", async () => {
  const f = await fixture();
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      authoredBy: "synthetic-fixture-author",
      basis: "Deliberately incomplete independent labels",
      candidates: [
        {
          key: "web",
          disposition: "accept",
          coverage: ["lantern"],
          edition: "standard_unmarked",
          plan: null,
        },
      ],
      ranking: null,
    }),
  );
  await writeFile(path.join(f.root, f.entry.labels.path), bytes);
  f.entry.labels.sha256 = createHash("sha256").update(bytes).digest("hex");
  await f.save();
  const loaded = await loadCorpus(f.filename);
  await expect(loaded.readCase(f.entry)).rejects.toThrow(
    "Independent corpus labels do not cover every candidate exactly once",
  );
});
