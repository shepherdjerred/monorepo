import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cruiseArchitectureFixtures,
  expectedFixtureRuleNames,
} from "#src/index.ts";

export type LayerSourceOptions = {
  /** Source root relative to the package root. Defaults to `src`. */
  sourceRoot?: string;
  /**
   * Also count top-level `.ts` modules (not tests or declarations) as layers,
   * for packages whose layers are files such as `contracts.ts`.
   */
  includeModules?: boolean;
  /** Entries left out, as a top-level name or a `parent/child` path. `index` is always left out. */
  ignore?: readonly string[];
  /** Top-level directories listed by their subdirectories instead of themselves. */
  expand?: readonly string[];
};

async function listDirectory(directory: string, includeModules: boolean) {
  const found = await readdir(directory, { withFileTypes: true });
  return found
    .filter(
      (entry) =>
        !entry.name.startsWith("__") &&
        (entry.isDirectory() ||
          (includeModules &&
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".test.ts") &&
            !entry.name.endsWith(".d.ts"))),
    )
    .map((entry) => entry.name.replace(/\.ts$/u, ""));
}

/**
 * The layer names a package's source tree implies, sorted: its top-level
 * directories (and optionally modules), with `expand`ed directories replaced
 * by their subdirectories.
 */
export async function sourceLayerNames(
  packageRoot: string,
  options: LayerSourceOptions = {},
): Promise<string[]> {
  const sourceDirectory = `${packageRoot}/${options.sourceRoot ?? "src"}`;
  const ignored = new Set(["index", ...(options.ignore ?? [])]);
  const expanded = new Set(options.expand);
  const names: string[] = [];
  const topLevel = await listDirectory(
    sourceDirectory,
    options.includeModules ?? false,
  );
  for (const name of topLevel) {
    if (ignored.has(name)) continue;
    if (!expanded.has(name)) {
      names.push(name);
      continue;
    }
    const children = await listDirectory(`${sourceDirectory}/${name}`, false);
    for (const child of children) {
      const layer = `${name}/${child}`;
      if (!ignored.has(layer)) names.push(layer);
    }
  }
  return names.sort();
}

/**
 * The standard architecture suite for a package: its negative fixtures prove
 * every declared boundary, and, when `layers` is given, the declared layer list
 * equals what is on disk so it can never go stale.
 */
export function describeArchitectureBoundaries(options: {
  packageRoot: string;
  architecture: unknown;
  layers?: readonly string[];
  layerSource?: LayerSourceOptions;
}): void {
  const { packageRoot, architecture, layers, layerSource } = options;
  describe("dependency-cruiser layer boundaries", () => {
    if (layers !== undefined) {
      it("declares exactly the source layers on disk", async () => {
        const onDisk = await sourceLayerNames(packageRoot, layerSource);

        expect([...layers].sort()).toEqual(onDisk);
      });
    }

    it("rejects a committed negative fixture for every declared boundary", async () => {
      const result = await cruiseArchitectureFixtures({
        packageRoot,
        definition: architecture,
      });

      expect(result.violatedRuleNames).toEqual(
        expectedFixtureRuleNames(architecture),
      );
      expect(result.errorCount).toBe(result.fixtureFiles.length);
    });
  });
}
