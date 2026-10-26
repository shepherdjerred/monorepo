import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  dependencyFixture,
  dependencyPath,
  originalDependencies,
  seedDependencyVault,
  verifyDependencyVault,
} from "./fixture.ts";

async function fixture(body: (vault: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "facet-dependency-fixture-"),
  );
  try {
    const vault = path.join(root, "vault");
    await seedDependencyVault(vault);
    await body(vault);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function edited(): string {
  const original = dependencyFixture()[dependencyPath];
  if (original === undefined) throw new Error("Missing dependency fixture");
  return original.replace(
    JSON.stringify(originalDependencies),
    JSON.stringify([
      { ...originalDependencies[0], gap: "P2D" },
      originalDependencies[1],
      { uid: "Tasks/Second.md", reltype: "STARTTOSTART", gap: "PT30M" },
    ]),
  );
}

test("dependency proof accepts only the intended exact records and unchanged files", async () => {
  await fixture(async (vault) => {
    expect(Object.keys(await verifyDependencyVault(vault, false))).toHaveLength(
      7,
    );
    await Bun.write(path.join(vault, dependencyPath), edited());
    await verifyDependencyVault(vault, true);
  });
});

test.each([
  ["UID", "[[Tasks/Target.md|Alias]]", "Tasks/Other.md"],
  ["gap", '"gap":"P2D"', '"gap":"P3D"'],
  [
    "configured default",
    '"reltype":"STARTTOSTART"',
    '"reltype":"FINISHTOSTART"',
  ],
  ["extension", '"keep":false', '"keep":true'],
  ["body", "Second line.", "Changed line."],
  ["creation metadata", "dateCreated: '2026-10-25", "dateCreated: '2026-10-24"],
])("dependency proof rejects changed %s", async (_, before, after) => {
  await fixture(async (vault) => {
    await Bun.write(
      path.join(vault, dependencyPath),
      edited().replace(before, after),
    );
    await expect(verifyDependencyVault(vault, true)).rejects.toThrow();
  });
});
