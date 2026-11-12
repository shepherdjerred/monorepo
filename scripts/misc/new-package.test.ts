import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
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
    expect(files["package.json"]).toContain(
      '"typecheck": "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit"',
    );
    expect(files["package.json"]).toContain(
      '"@typescript/native": "npm:typescript@7.0.2"',
    );
    expect(files["eslint.config.ts"]).toContain("recommended");
    expect(files["tsconfig.json"]).toContain('"eslint.config.ts"');
    expect(files["ci-tests.json"]).toContain('"runner": "vitest"');
    expect(files["package.json"]).toContain('"test:ci"');
    expect(files["src/index.test.ts"]).toContain('from "vitest"');
  });

  test("pins the toolchain versions the scripts workspace runs", async () => {
    const Manifest = z.looseObject({
      devDependencies: z.record(z.string(), z.string()),
    });
    const scripts = Manifest.parse(
      await Bun.file(path.join(import.meta.dirname, "../package.json")).json(),
    ).devDependencies;
    const scaffold = Manifest.parse(
      JSON.parse(packageFiles("example-package")["package.json"] ?? ""),
    ).devDependencies;
    // A stale pin resolves a second, unpatched copy of a patched dependency.
    for (const [dependency, version] of Object.entries(scaffold))
      expect(version, dependency).toBe(scripts[dependency]);
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
