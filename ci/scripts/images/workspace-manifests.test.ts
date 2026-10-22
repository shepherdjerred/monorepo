import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { WorkspacePackage } from "../selectors/select-image-targets-workspaces.ts";
import {
  closureManifestPaths,
  writeClosureManifests,
} from "./workspace-manifests.ts";

function workspaces(
  entries: Record<string, readonly [string, readonly string[]]>,
): Map<string, WorkspacePackage> {
  return new Map(
    Object.entries(entries).map(([name, [dir, workspaceDependencies]]) => [
      name,
      { dir: `${dir}/`, workspaceDependencies },
    ]),
  );
}

const graph = workspaces({
  "@demo/app": ["packages/app", ["@demo/lib"]],
  "@demo/lib": ["packages/lib", ["@demo/base"]],
  "@demo/base": ["packages/base", []],
  "@game/backend": ["packages/game/packages/backend", ["@game/common"]],
  "@game/common": ["packages/game/packages/common", []],
  "@game/frontend": ["packages/game/packages/frontend", ["@demo/base"]],
  unrelated: ["packages/unrelated", []],
});

describe("closureManifestPaths", () => {
  test("projects the root manifest plus the transitive workspace closure", () => {
    expect(closureManifestPaths(["@demo/app"], graph)).toEqual([
      "package.json",
      "packages/app/package.json",
      "packages/base/package.json",
      "packages/lib/package.json",
    ]);
  });

  test("unions every filter and matches Bun filter name globs", () => {
    expect(closureManifestPaths(["@game/*", "@game/backend"], graph)).toEqual([
      "package.json",
      "packages/base/package.json",
      "packages/game/packages/backend/package.json",
      "packages/game/packages/common/package.json",
      "packages/game/packages/frontend/package.json",
    ]);
  });

  test("fails loudly for a filter that names no workspace", () => {
    expect(() => closureManifestPaths(["@demo/missing"], graph)).toThrow(
      "install filter matches no workspace: @demo/missing",
    );
    expect(() => closureManifestPaths([], graph)).toThrow(
      "at least one filter is required",
    );
  });
});

describe("writeClosureManifests", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("copies only the closure manifests into the output root", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "closure-in-"));
    const outputRoot = await mkdtemp(path.join(tmpdir(), "closure-out-"));
    roots.push(workspaceRoot, outputRoot);
    const manifests: Record<string, Record<string, unknown>> = {
      "package.json": {
        name: "root",
        workspaces: ["packages/app", "packages/lib", "packages/unrelated"],
      },
      "packages/app/package.json": {
        name: "@demo/app",
        dependencies: { "@demo/lib": "workspace:*", zod: "4.0.0" },
      },
      "packages/lib/package.json": { name: "@demo/lib" },
      "packages/unrelated/package.json": {
        name: "unrelated",
        scripts: { build: "changed" },
      },
    };
    for (const [file, manifest] of Object.entries(manifests)) {
      await mkdir(path.dirname(path.join(workspaceRoot, file)), {
        recursive: true,
      });
      await Bun.write(path.join(workspaceRoot, file), JSON.stringify(manifest));
    }

    expect(
      await writeClosureManifests(workspaceRoot, outputRoot, ["@demo/app"]),
    ).toEqual([
      "package.json",
      "packages/app/package.json",
      "packages/lib/package.json",
    ]);
    const written = await readdir(path.join(outputRoot, "packages"));
    expect(written.sort()).toEqual(["app", "lib"]);
    expect(
      await Bun.file(path.join(outputRoot, "packages/app/package.json")).text(),
    ).toBe(JSON.stringify(manifests["packages/app/package.json"]));
  });
});
