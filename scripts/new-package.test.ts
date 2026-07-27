import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  packageFiles,
  validatePackageName,
  writePackageScaffold,
} from "./migration-core.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("new-package", () => {
  test("requires kebab-case", () => {
    expect(() => validatePackageName("Bad_Name")).toThrow("kebab-name");
    expect(() => validatePackageName()).toThrow("kebab-name");
  });

  test("creates strict quality configuration", () => {
    const files = packageFiles(validatePackageName("example-package"));
    expect(files["package.json"]).toContain('"typecheck": "tsc --noEmit"');
    expect(files["eslint.config.ts"]).toContain("recommended");
    expect(files["src/index.test.ts"]).toContain("bun:test");
  });

  test("creates package and nested source directories", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "new-package-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const name = validatePackageName("example-package");
    const directory = `${temporaryDirectory}/packages/${name}`;

    await writePackageScaffold(directory, name);

    for (const [relativePath, contents] of Object.entries(packageFiles(name))) {
      expect(await Bun.file(`${directory}/${relativePath}`).text()).toBe(
        contents,
      );
    }
  });
});
