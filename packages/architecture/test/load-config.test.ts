import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadArchitectureDefinition } from "#src/load-config.ts";

let packageRoot = "";

beforeEach(async () => {
  packageRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "architecture-config-")),
  );
});

afterEach(async () => {
  await rm(packageRoot, { recursive: true, force: true });
});

describe("loadArchitectureDefinition", () => {
  it("falls back to the baseline when a package declares no config", async () => {
    await expect(loadArchitectureDefinition(packageRoot)).resolves.toEqual({
      sourceRoot: "src",
      tsConfigFileName: "tsconfig.json",
      boundaries: [],
    });
  });

  it("reads the boundaries a package does declare", async () => {
    await writeFile(
      path.join(packageRoot, "architecture.config.ts"),
      'export default {\n  boundaries: [\n    {\n      name: "domain-is-pure",\n      comment: "the domain must be usable without a transport",\n      from: "domain",\n      to: ["server"],\n    },\n  ],\n};\n',
      "utf8",
    );

    const definition = await loadArchitectureDefinition(packageRoot);

    expect(definition.boundaries).toEqual([
      {
        name: "domain-is-pure",
        comment: "the domain must be usable without a transport",
        from: "domain",
        to: ["server"],
      },
    ]);
  });

  it("refuses a config without a default export", async () => {
    await writeFile(
      path.join(packageRoot, "architecture.config.ts"),
      "export const boundaries = [];\n",
      "utf8",
    );

    await expect(loadArchitectureDefinition(packageRoot)).rejects.toThrow(
      /must have a default export/u,
    );
  });

  it("refuses a config that does not validate", async () => {
    await writeFile(
      path.join(packageRoot, "architecture.config.ts"),
      'export default { boundaries: [{ name: "x", comment: "", from: "a", to: [] }] };\n',
      "utf8",
    );

    await expect(loadArchitectureDefinition(packageRoot)).rejects.toThrow();
  });

  it("does not mistake an unreadable config for an absent one", async () => {
    // A directory where the config file should be: `stat` succeeds, so this
    // is not ENOENT and must not silently degrade to the baseline.
    await mkdir(path.join(packageRoot, "architecture.config.ts"));

    await expect(loadArchitectureDefinition(packageRoot)).rejects.toThrow();
  });
});
