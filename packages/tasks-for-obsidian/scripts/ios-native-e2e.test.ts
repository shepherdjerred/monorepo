import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireStableSources, verifyVault } from "./ios-native-e2e.ts";

it("source provenance rejects changed, added or removed build inputs", () => {
  expect(() =>
    requireStableSources({ "a.swift": "sha-a" }, { "a.swift": "sha-a" }),
  ).not.toThrow();
  expect(() =>
    requireStableSources({ "a.swift": "sha-a" }, { "a.swift": "sha-b" }),
  ).toThrow();
  expect(() =>
    requireStableSources(
      { "a.swift": "sha-a" },
      { "a.swift": "sha-a", "b.swift": "sha-b" },
    ),
  ).toThrow();
  expect(() => requireStableSources({ "a.swift": "sha-a" }, {})).toThrow();
});

const fixture = path.resolve(
  import.meta.dir,
  "../../tasknotes-fixtures/e2e/local-vault",
);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function outputVault(
  title = "E2E edited task",
  status = "done",
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "facet-e2e-assertions-"));
  directories.push(directory);
  await cp(fixture, directory, { recursive: true });
  await Bun.write(
    path.join(directory, "Created.md"),
    `---\ntitle: ${title}\nstatus: ${status}\ntags: [task]\ncompletedDate: "2026-10-10T12:00:00Z"\n---\n`,
  );
  return directory;
}

describe("native E2E filesystem acceptance", () => {
  it("accepts a persisted edit/completion while preserving the original files", async () => {
    await expect(verifyVault(await outputVault())).resolves.toBeUndefined();
  });

  it.each([
    ["E2E captured task", "done"],
    ["E2E edited task", "open"],
  ])(
    "rejects a GUI journey that did not persist %s / %s",
    async (title, status) => {
      await expect(
        verifyVault(await outputVault(title, status)),
      ).rejects.toThrow();
    },
  );

  it("rejects collateral changes to a preexisting note", async () => {
    const vault = await outputVault();
    await Bun.write(path.join(vault, "Reference.md"), "Rewritten reference\n");
    await expect(verifyVault(vault)).rejects.toThrow(
      "Fixture changed: Reference.md",
    );
  });

  it("rejects a duplicate capture or a persisted discarded draft", async () => {
    const vault = await outputVault();
    await Bun.write(path.join(vault, "Unexpected.md"), "Unexpected task\n");
    await expect(verifyVault(vault)).rejects.toThrow("Expected two task notes");
  });
});
