import { describe, expect, test } from "vitest";
import {
  isRecord,
  parseJsonc,
} from "../../selectors/select-image-targets-lockfile.ts";
import { printLockfile, projectInstallInputs } from "./install-projection.ts";

// A bun.lock in Bun's exact layout: @demo/app depends on @demo/lib, which pins
// an older `left` (nested key); @demo/other owns the hoisted `left`, a patched
// and overridden `only-other`, and nothing else in the closure reaches it.
const LOCKFILE = `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
      "devDependencies": {
        "tool": "1.0.0",
      },
    },
    "packages/app": {
      "name": "@demo/app",
      "dependencies": {
        "@demo/lib": "workspace:*",
        "react-ish": "^1.0.0",
      },
    },
    "packages/lib": {
      "name": "@demo/lib",
      "dependencies": {
        "left": "^1.0.0",
        "patched": "2.0.0",
      },
    },
    "packages/other": {
      "name": "@demo/other",
      "version": "0.1.0",
      "dependencies": {
        "left": "^2.0.0",
        "only-other": "1.0.0",
      },
    },
  },
  "trustedDependencies": [
    "patched",
  ],
  "patchedDependencies": {
    "only-other@1.0.0": "patches/only-other@1.0.0.patch",
    "patched@2.0.0": "patches/patched@2.0.0.patch",
  },
  "overrides": {
    "deep": "1.0.0",
    "only-other": "1.0.0",
  },
  "packages": {
    "@demo/app": ["@demo/app@workspace:packages/app"],

    "@demo/lib": ["@demo/lib@workspace:packages/lib"],

    "@demo/other": ["@demo/other@workspace:packages/other"],

    "deep": ["deep@1.0.0", "", {}, "sha512-deep"],

    "left": ["left@2.0.0", "", { "dependencies": { "deep": "^1.0.0" } }, "sha512-left2"],

    "only-other": ["only-other@1.0.0", "", {}, "sha512-only1"],

    "optional-thing": ["optional-thing@1.0.0", "", { "os": [ "linux", "darwin", ], "cpu": "x64" }, "sha512-opt"],

    "patched": ["patched@2.0.0", "", {}, "sha512-patched"],

    "react-ish": ["react-ish@1.0.0", "", { "peerDependencies": { "deep": "^1.0.0", "optional-thing": "*" }, "optionalPeers": ["optional-thing"] }, "sha512-react"],

    "tool": ["tool@1.0.0", "", { "bin": { "tool": "bin.js" } }, "sha512-tool"],

    "@demo/lib/left": ["left@1.0.0", "", {}, "sha512-left1"],
  }
}
`;

const ROOT_MANIFEST = `${JSON.stringify(
  {
    name: "root",
    private: true,
    scripts: { postinstall: "echo linked", verify: "bun verify.ts" },
    devDependencies: { tool: "1.0.0" },
    workspaces: ["packages/app", "packages/lib", "packages/other"],
    overrides: { deep: "1.0.0", "only-other": "1.0.0" },
    trustedDependencies: ["patched"],
    patchedDependencies: {
      "only-other@1.0.0": "patches/only-other@1.0.0.patch",
      "patched@2.0.0": "patches/patched@2.0.0.patch",
    },
    packageManager: "bun@1.4.5",
  },
  null,
  2,
)}\n`;

const APP = ["packages/app", "packages/lib"];

function lockObject(text: string): Record<string, unknown> {
  const parsed = parseJsonc(text);
  if (!isRecord(parsed)) throw new Error("lockfile must be an object");
  return parsed;
}

function keys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

describe("printLockfile", () => {
  test("reproduces Bun's lockfile layout byte for byte", () => {
    expect(printLockfile(lockObject(LOCKFILE))).toBe(LOCKFILE);
  });
});

const project = (lockfile = LOCKFILE, workspaceDirs = APP) =>
  projectInstallInputs({
    rootManifest: ROOT_MANIFEST,
    lockfile,
    workspaceDirs,
  });

describe("projectInstallInputs", () => {
  test("keeps only the closure's workspaces, packages, overrides and patches", () => {
    const projection = project();
    const lock = lockObject(projection.lockfile);
    expect(keys(lock["workspaces"])).toEqual([
      "",
      "packages/app",
      "packages/lib",
    ]);
    // Root tooling is never linked by a filtered install.
    expect(isRecord(lock["workspaces"]) && lock["workspaces"][""]).toEqual({
      name: "root",
    });
    // The optional peer, the other workspace's hoisted `left` and its
    // exclusive package drop out; the nested `left` the closure uses stays.
    expect(keys(lock["packages"])).toEqual([
      "@demo/app",
      "@demo/lib",
      "deep",
      "patched",
      "react-ish",
      "@demo/lib/left",
    ]);
    expect(lock["overrides"]).toEqual({ deep: "1.0.0" });
    expect(lock["patchedDependencies"]).toEqual({
      "patched@2.0.0": "patches/patched@2.0.0.patch",
    });
    expect(lock["trustedDependencies"]).toEqual(["patched"]);
    expect(projection.patches).toEqual(["patches/patched@2.0.0.patch"]);
    expect(JSON.parse(projection.manifest)).toEqual({
      name: "root",
      private: true,
      scripts: { postinstall: "echo linked" },
      workspaces: APP,
      overrides: { deep: "1.0.0" },
      trustedDependencies: ["patched"],
      patchedDependencies: {
        "patched@2.0.0": "patches/patched@2.0.0.patch",
      },
      packageManager: "bun@1.4.5",
    });
  });

  test("is byte-deterministic", () => {
    expect(project()).toEqual(project());
    expect(project().lockfile).toBe(
      printLockfile(lockObject(project().lockfile)),
    );
  });

  test("a dependency change outside the closure leaves the projection unchanged", () => {
    // @demo/other bumps its exclusive dependency and adds a new one.
    const changed = LOCKFILE.replace(
      `"only-other": "1.0.0",\n      },`,
      `"fresh": "3.0.0",\n        "only-other": "1.1.0",\n      },`,
    ).replace(
      `"only-other": ["only-other@1.0.0", "", {}, "sha512-only1"],`,
      `"fresh": ["fresh@3.0.0", "", {}, "sha512-fresh"],\n\n    "only-other": ["only-other@1.1.0", "", {}, "sha512-only2"],`,
    );
    expect(changed).not.toBe(LOCKFILE);
    expect(project(changed)).toEqual(project());
    expect(project(changed, ["packages/other"])).not.toEqual(
      project(LOCKFILE, ["packages/other"]),
    );
  });

  test("fails loudly on an unknown lockfile shape or workspace", () => {
    expect(() =>
      project(
        LOCKFILE.replace(
          `"configVersion": 1,`,
          `"configVersion": 1,\n  "future": {},`,
        ),
      ),
    ).toThrow("unknown lockfile key: future");
    expect(() => project(LOCKFILE, ["packages/missing"])).toThrow(
      "not an installable lockfile workspace: packages/missing",
    );
    expect(() => project(LOCKFILE, [""])).toThrow(
      "not an installable lockfile workspace: ",
    );
  });
});
