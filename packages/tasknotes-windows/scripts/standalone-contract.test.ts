import { afterEach, describe, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseStandaloneDescriptor,
  prepareStandaloneRun,
  relativeSeedPath,
  sha256,
  standaloneRunOptions,
  standaloneScenarioManifest,
  validateStandaloneEvidence,
} from "./standalone-contract.ts";

const family = "red.sjer.TaskNotes.E2E_1234567890123";
const runId = "11111111-2222-3333-4444-555555555555";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-acceptance-")),
  );
  roots.push(root);
  const localState = path.join(root, "LocalState");
  const seed = path.join(root, "seed");
  await mkdir(localState);
  await mkdir(seed);
  await writeFile(
    path.join(seed, "tasknotes.yaml"),
    "title:\n  storage: frontmatter\n",
  );
  await writeFile(
    path.join(seed, "Existing.md"),
    "---\ntitle: Preserve me\ncustom: 'exact'\n---\n",
  );
  return { root, localState, seed };
}

describe("standalone acceptance descriptor", () => {
  test("native evidence must have exact run, scenario and complete assertion inventory", async () => {
    const manifest = await standaloneScenarioManifest();
    const evidence = {
      schemaVersion: 1,
      runId,
      scenario: "standalone-production",
      composition: "FacetTaskNotesStore",
      completed: true,
      assertions: manifest.scenarios["standalone-production"],
    };
    await expect(
      validateStandaloneEvidence(evidence, runId, "standalone-production"),
    ).resolves.toEqual(evidence);
    for (const patch of [
      { runId: crypto.randomUUID() },
      { scenario: "visual-modes" },
      { composition: "legacy-server" },
      { completed: false },
      { unknown: true },
      { assertions: evidence.assertions.slice(1) },
      { assertions: [...evidence.assertions, ...evidence.assertions] },
    ])
      await expect(
        validateStandaloneEvidence(
          { ...evidence, ...patch },
          runId,
          "standalone-production",
        ),
      ).rejects.toThrow();
  });

  test("runner only selects committed standalone producers", () => {
    expect(standaloneRunOptions([])).toBe("standalone-production");
    expect(standaloneRunOptions(["--scenario", "visual-modes"])).toBe(
      "visual-modes",
    );
    for (const options of [
      ["--scenario", "onboarding-auth"],
      ["--scenario"],
      ["--unknown"],
      ["--scenario", "standalone-production", "--other"],
    ])
      expect(() => standaloneRunOptions(options)).toThrow();
  });
  test("stages an isolated fresh run with exact seed and binary hashes", async () => {
    const files = await fixture();
    const staged = await prepareStandaloneRun(
      files.localState,
      family,
      files.seed,
      { runId },
    );
    expect(staged.descriptor.profileId).toBe(`acceptance-${runId}`);
    expect(staged.descriptor.seedFiles).toHaveLength(3);
    for (const seed of staged.descriptor.seedFiles) {
      expect(sha256(await readFile(path.join(staged.vault, seed.path)))).toBe(
        seed.sha256,
      );
    }
    const descriptor: unknown = JSON.parse(
      await readFile(staged.descriptorPath, "utf8"),
    );
    expect(
      parseStandaloneDescriptor(descriptor, files.localState, family),
    ).toEqual(staged.descriptor);
    await expect(
      prepareStandaloneRun(files.localState, family, files.seed, { runId }),
    ).rejects.toThrow();
    expect(
      await readFile(path.join(files.seed, "Existing.md"), "utf8"),
    ).toContain("custom: 'exact'");
  });

  test("closed contract rejects changed identity, unknown fields and duplicate seeds", async () => {
    const files = await fixture();
    const { descriptor } = await prepareStandaloneRun(
      files.localState,
      family,
      files.seed,
      { runId },
    );
    for (const patch of [
      { runId: runId.toUpperCase().replace("11111111", "AAAAAAAA") },
      { profileId: "another-profile" },
      { packageFamilyName: "red.sjer.TaskNotes.E2E_0000000000000" },
      { stateDirectory: files.localState },
      { unknown: true },
      { seedFiles: [...descriptor.seedFiles, ...descriptor.seedFiles] },
      {
        seedFiles: [
          { path: "tasknotes.yaml", sha256: "0".repeat(64) },
          { path: "TASKNOTES.yaml", sha256: "0".repeat(64) },
        ],
      },
      { seedFiles: [{ path: "Existing.md", sha256: "invalid" }] },
    ])
      expect(() =>
        parseStandaloneDescriptor(
          { ...descriptor, ...patch },
          files.localState,
          family,
        ),
      ).toThrow();
  });

  test.each([
    "../outside.md",
    "/outside.md",
    String.raw`a\b.md`,
    "task.md:stream",
    "CON",
    "COM1.md",
    "a./b",
    "a /b",
    "a//b",
    "a/../b",
    "a\u0000b",
  ])("rejects noncanonical seed path %j", (value) => {
    expect(() => relativeSeedPath(value)).toThrow();
  });

  test("linked fixture and linked LocalState parents reject before staging", async () => {
    const files = await fixture();
    await symlink(
      path.join(files.seed, "Existing.md"),
      path.join(files.seed, "Linked.md"),
    );
    await expect(
      prepareStandaloneRun(files.localState, family, files.seed, { runId }),
    ).rejects.toThrow("links");
    await rm(path.join(files.seed, "Linked.md"));
    const alias = path.join(files.root, "alias");
    await symlink(files.localState, alias);
    await expect(
      prepareStandaloneRun(alias, family, files.seed, { runId }),
    ).rejects.toThrow("links");
  });

  test("missing real configuration rejects before creating a run", async () => {
    const files = await fixture();
    await rm(path.join(files.seed, "tasknotes.yaml"));
    await expect(
      prepareStandaloneRun(files.localState, family, files.seed, { runId }),
    ).rejects.toThrow("configuration");
  });
});
