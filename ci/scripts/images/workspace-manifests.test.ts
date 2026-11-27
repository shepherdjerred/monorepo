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

// The fixture workspace's bun.lock: `unrelated` owns a package and a patch no
// other workspace reaches.
const FIXTURE_LOCKFILE = `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
    },
    "packages/app": {
      "name": "@demo/app",
      "dependencies": {
        "@demo/lib": "workspace:*",
        "zod": "4.0.0",
      },
    },
    "packages/lib": {
      "name": "@demo/lib",
    },
    "packages/unrelated": {
      "name": "unrelated",
      "dependencies": {
        "left-pad": "1.3.0",
      },
    },
  },
  "patchedDependencies": {
    "left-pad@1.3.0": "patches/left-pad@1.3.0.patch",
  },
  "packages": {
    "@demo/app": ["@demo/app@workspace:packages/app"],

    "@demo/lib": ["@demo/lib@workspace:packages/lib"],

    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-pad"],

    "unrelated": ["unrelated@workspace:packages/unrelated"],

    "zod": ["zod@4.0.0", "", {}, "sha512-zod"],
  }
}
`;

describe("writeClosureManifests", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function fixtureWorkspace(): Promise<{
    workspaceRoot: string;
    outputRoot: string;
    manifests: Record<string, Record<string, unknown>>;
  }> {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "closure-in-"));
    const outputRoot = await mkdtemp(path.join(tmpdir(), "closure-out-"));
    roots.push(workspaceRoot, outputRoot);
    const manifests: Record<string, Record<string, unknown>> = {
      "package.json": {
        name: "root",
        workspaces: ["packages/app", "packages/lib", "packages/unrelated"],
        patchedDependencies: {
          "left-pad@1.3.0": "patches/left-pad@1.3.0.patch",
        },
      },
      "packages/app/package.json": {
        name: "@demo/app",
        dependencies: { "@demo/lib": "workspace:*", zod: "4.0.0" },
      },
      "packages/lib/package.json": { name: "@demo/lib" },
      "packages/unrelated/package.json": {
        name: "unrelated",
        dependencies: { "left-pad": "1.3.0" },
      },
    };
    const files: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(manifests).map(([file, manifest]) => [
          file,
          JSON.stringify(manifest),
        ]),
      ),
      "bun.lock": FIXTURE_LOCKFILE,
      "patches/left-pad@1.3.0.patch": "diff\n",
    };
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(workspaceRoot, file)), {
        recursive: true,
      });
      await Bun.write(path.join(workspaceRoot, file), text);
    }
    return { workspaceRoot, outputRoot, manifests };
  }

  test("writes the closure manifests and its projected root install inputs", async () => {
    const { workspaceRoot, outputRoot, manifests } = await fixtureWorkspace();
    expect(
      await writeClosureManifests(workspaceRoot, outputRoot, ["@demo/app"]),
    ).toEqual([
      "package.json",
      "bun.lock",
      "packages/app/package.json",
      "packages/lib/package.json",
    ]);
    const outputs = await readdir(outputRoot);
    expect(outputs.sort()).toEqual(["bun.lock", "package.json", "packages"]);
    const written = await readdir(path.join(outputRoot, "packages"));
    expect(written.sort()).toEqual(["app", "lib"]);
    expect(
      await Bun.file(path.join(outputRoot, "packages/app/package.json")).text(),
    ).toBe(JSON.stringify(manifests["packages/app/package.json"]));
    const lockfile = await Bun.file(path.join(outputRoot, "bun.lock")).text();
    expect(lockfile).toContain(`"zod": ["zod@4.0.0"`);
    expect(lockfile).not.toContain("left-pad");
    const manifest = await Bun.file(
      path.join(outputRoot, "package.json"),
    ).text();
    expect(JSON.parse(manifest)).toEqual({
      name: "root",
      workspaces: ["packages/app", "packages/lib"],
    });
  });

  test("copies only the patches the closure installs", async () => {
    const { workspaceRoot, outputRoot } = await fixtureWorkspace();
    expect(
      await writeClosureManifests(workspaceRoot, outputRoot, ["unrelated"]),
    ).toEqual([
      "package.json",
      "bun.lock",
      "patches/left-pad@1.3.0.patch",
      "packages/unrelated/package.json",
    ]);
    expect(
      await Bun.file(
        path.join(outputRoot, "patches/left-pad@1.3.0.patch"),
      ).text(),
    ).toBe("diff\n");
  });

  test("refuses a filter that selects the root workspace", async () => {
    const { workspaceRoot, outputRoot } = await fixtureWorkspace();
    await expect(
      writeClosureManifests(workspaceRoot, outputRoot, ["r*"]),
    ).rejects.toThrow("install filter selects the root workspace: r*");
  });
});
