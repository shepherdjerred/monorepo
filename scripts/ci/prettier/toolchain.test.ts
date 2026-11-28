import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import { createTempGitRepo, type TempGitRepo } from "../../lib/test-git.ts";
import { SHARD_NAMES } from "../repo-shards.ts";
import {
  changedFilesForShard,
  prettierChangedDigest,
} from "../run-shard-check.ts";
import {
  prettierLockSlice,
  prettierPackageJsonSlice,
  prettierPluginNames,
  prettierToolchainChanged,
} from "./toolchain.ts";

type LockPackages = Record<string, readonly unknown[]>;

const revision = (output: string): string => output.trim();

const BASE_PACKAGES: LockPackages = {
  prettier: ["prettier@3.10.1", "", {}, "sha512-prettier"],
  "prettier-plugin-astro": [
    "prettier-plugin-astro@1.1.2",
    "",
    {
      dependencies: {
        "@astrojs/compiler-rs": "^0.5.2",
        "sass-formatter": "^0.8",
      },
      peerDependencies: { prettier: "^3.5.3" },
    },
    "sha512-plugin",
  ],
  "@astrojs/compiler-rs": ["@astrojs/compiler-rs@0.5.2", "", {}, "sha512-rs"],
  "sass-formatter": [
    "sass-formatter@0.8.0",
    "",
    { dependencies: { suf: "^0.1" } },
    "sha512-sass",
  ],
  suf: ["suf@0.1.0", "", {}, "sha512-suf"],
  "@acme/fmt": ["@acme/fmt@1.0.0", "", {}, "sha512-fmt"],
  turbo: ["turbo@2.11.13", "", {}, "sha512-turbo"],
  eslint: ["eslint@9.0.0", "", {}, "sha512-eslint"],
  "eslint-config-prettier": [
    "eslint-config-prettier@10.0.0",
    "",
    { peerDependencies: { eslint: ">=7" } },
    "sha512-ecp",
  ],
  "@cdktn/hcl2cdk": [
    "@cdktn/hcl2cdk@0.25.1",
    "",
    { dependencies: { prettier: "2.8.8", suf: "^0.1" } },
    "sha512-cdktn",
  ],
  "@cdktn/hcl2cdk/prettier": ["prettier@2.8.8", "", {}, "sha512-prettier2"],
};

function lock(
  overrides: LockPackages = {},
  remove: readonly string[] = [],
  extra: Record<string, unknown> = {},
): string {
  const packages: LockPackages = { ...BASE_PACKAGES, ...overrides };
  for (const key of remove) Reflect.deleteProperty(packages, key);
  // bun.lock is JSONC: trailing commas must be accepted.
  return `${JSON.stringify({ lockfileVersion: 2, workspaces: {}, ...extra, packages }, null, 2).replaceAll(/\n(\s*)\}/gu, ",\n$1}")}\n`;
}

function manifest(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "monorepo",
    scripts: { verify: "bun scripts/verify.ts" },
    devDependencies: { prettier: "^3.9.9", turbo: "2.11.13" },
    ...fields,
  });
}

const PLUGINS = ["prettier-plugin-astro"];

describe("prettierPluginNames", () => {
  test("collects plugins wherever the configuration lists them, as package names", () => {
    expect(
      prettierPluginNames(
        JSON.stringify({
          plugins: ["prettier-plugin-astro", "@acme/fmt/plugin"],
          overrides: [{ files: "*.md", options: { plugins: ["@acme/md"] } }],
        }),
        null,
      ),
    ).toEqual(["@acme/fmt", "@acme/md", "prettier-plugin-astro"]);
  });

  test("reads the package.json prettier key, as an object or a shared configuration name", () => {
    expect(
      prettierPluginNames(
        null,
        manifest({ prettier: { plugins: ["shared-fmt/plugin"] } }),
      ),
    ).toEqual(["shared-fmt"]);
    expect(
      prettierPluginNames(
        null,
        manifest({ prettier: "@acme/prettier-config" }),
      ),
    ).toEqual(["@acme/prettier-config"]);
  });

  test("a string .prettierrc.json names a shared configuration package", () => {
    expect(
      prettierPluginNames(JSON.stringify("@acme/prettier-config"), null),
    ).toEqual(["@acme/prettier-config"]);
  });

  test.each([
    "./local.js",
    "../local.js",
    "/abs/plugin.js",
    "file:///plugin.js",
    "@scoped-only",
  ])("%s cannot be mapped to a lock key", (specifier) => {
    expect(() =>
      prettierPluginNames(JSON.stringify({ plugins: [specifier] }), null),
    ).toThrow(/not a package name/u);
    expect(() =>
      prettierPluginNames(
        null,
        manifest({ prettier: { plugins: [specifier] } }),
      ),
    ).toThrow(/not a package name/u);
  });
});

describe("prettierPackageJsonSlice", () => {
  test("scripts, unrelated dependencies and new fields are invisible to Prettier", () => {
    const base = prettierPackageJsonSlice(manifest());
    expect(
      prettierPackageJsonSlice(
        manifest({
          scripts: { verify: "x", "e2e:affected": "bun e2e.ts" },
          devDependencies: { prettier: "^3.9.9", turbo: "2.12.0", knip: "6" },
          workspaces: ["packages/new-package"],
        }),
      ),
    ).toBe(base);
  });

  test("a Prettier key, specifier, override or patch is visible", () => {
    const base = prettierPackageJsonSlice(manifest());
    for (const fields of [
      { prettier: { semi: false } },
      { devDependencies: { prettier: "^3.10.0", turbo: "2.11.13" } },
      { overrides: { prettier: "3.9.9" } },
      { resolutions: { "some-dep": { prettier: "2.8.8" } } },
      { patchedDependencies: { "prettier@3.10.1": "patches/p.patch" } },
      // A patch to any package may change the closure, not only Prettier's own.
      { patchedDependencies: { "sass-formatter@0.8.0": "patches/s.patch" } },
    ]) {
      expect(prettierPackageJsonSlice(manifest(fields))).not.toBe(base);
    }
  });

  test("a present section of the wrong shape is unreadable, an absent one is empty", () => {
    expect(() =>
      prettierPackageJsonSlice(manifest({ overrides: [] })),
    ).toThrow();
    expect(() =>
      prettierPackageJsonSlice(manifest({ patchedDependencies: "x" })),
    ).toThrow();
    expect(prettierPackageJsonSlice(manifest())).toBe(
      prettierPackageJsonSlice(manifest({ overrides: undefined })),
    );
  });

  test("packages that only mention Prettier are invisible", () => {
    const base = prettierPackageJsonSlice(manifest());
    expect(
      prettierPackageJsonSlice(
        manifest({
          devDependencies: {
            prettier: "^3.9.9",
            turbo: "2.11.13",
            "eslint-config-prettier": "^10.1.0",
          },
        }),
      ),
    ).toBe(base);
  });
});

describe("prettierLockSlice", () => {
  const base = prettierLockSlice(lock(), PLUGINS);

  test("adding or bumping a package Prettier does not load changes nothing", () => {
    expect(
      prettierLockSlice(
        lock({
          turbo: ["turbo@2.12.0", "", {}, "sha512-turbo2"],
          "brand-new": ["brand-new@1.0.0", "", {}, "sha512-new"],
        }),
        PLUGINS,
      ),
    ).toBe(base);
  });

  test("Prettier, a plugin and a plugin's transitive dependency are visible", () => {
    for (const change of [
      { prettier: ["prettier@3.10.2", "", {}, "sha512-p2"] },
      {
        "prettier-plugin-astro": [
          "prettier-plugin-astro@1.1.3",
          "",
          BASE_PACKAGES["prettier-plugin-astro"]?.[2],
          "sha512-plugin3",
        ],
      },
      { "@astrojs/compiler-rs": ["@astrojs/compiler-rs@0.5.3", "", {}, "x"] },
      { suf: ["suf@0.1.1", "", {}, "sha512-suf2"] },
    ]) {
      expect(prettierLockSlice(lock(change), PLUGINS)).not.toBe(base);
    }
  });

  test("a dependency nested under the plugin shadows the hoisted one", () => {
    const nested = lock({
      "prettier-plugin-astro/sass-formatter": [
        "sass-formatter@0.9.0",
        "",
        {},
        "sha512-sass9",
      ],
    });
    expect(prettierLockSlice(nested, PLUGINS)).not.toBe(base);
  });

  test("a nested copy of Prettier under another package is still a Prettier input", () => {
    expect(
      prettierLockSlice(
        lock({
          "@cdktn/hcl2cdk/prettier": ["prettier@2.8.9", "", {}, "x"],
        }),
        PLUGINS,
      ),
    ).not.toBe(base);
  });

  test("a package unrelated to Prettier that shares a dependency is not an input", () => {
    expect(
      prettierLockSlice(
        lock({
          "@cdktn/hcl2cdk": [
            "@cdktn/hcl2cdk@0.26.0",
            "",
            { dependencies: { suf: "^0.1" } },
            "sha512-cdktn2",
          ],
        }),
        PLUGINS,
      ),
    ).toBe(base);
  });

  test("a configured plugin whose name does not mention Prettier is an input", () => {
    const change = { "@acme/fmt": ["@acme/fmt@1.1.0", "", {}, "sha512-fmt2"] };
    expect(prettierLockSlice(lock(change), PLUGINS)).toBe(base);
    expect(prettierLockSlice(lock(change), ["@acme/fmt"])).not.toBe(
      prettierLockSlice(lock(), ["@acme/fmt"]),
    );
  });

  test("a git plugin's dependencies, whose metadata sits at index 1, are inputs", () => {
    const git = {
      "git-fmt": [
        "git-fmt@github:acme/git-fmt#abc",
        { dependencies: { "printer-core": "^1" } },
        "abc",
      ],
      "printer-core": ["printer-core@1.0.0", "", {}, "sha512-core"],
    };
    const bump = {
      ...git,
      "printer-core": ["printer-core@1.1.0", "", {}, "sha512-core2"],
    };
    expect(prettierLockSlice(lock(bump), ["git-fmt"])).not.toBe(
      prettierLockSlice(lock(git), ["git-fmt"]),
    );
  });

  test("a lock entry with malformed dependency metadata is unreadable", () => {
    const broken = { "git-fmt": ["git-fmt@1.0.0", { dependencies: [] }] };
    expect(() => prettierLockSlice(lock(broken), ["git-fmt"])).toThrow();
  });

  test("a bump of eslint-config-prettier or eslint is not an input", () => {
    expect(
      prettierLockSlice(
        lock({
          eslint: ["eslint@9.1.0", "", {}, "sha512-eslint2"],
          "eslint-config-prettier": [
            "eslint-config-prettier@10.1.0",
            "",
            { peerDependencies: { eslint: ">=7" } },
            "sha512-ecp2",
          ],
        }),
        PLUGINS,
      ),
    ).toBe(base);
  });

  test("a patch to any package, not only Prettier's, is visible", () => {
    expect(
      prettierLockSlice(
        lock({}, [], {
          patchedDependencies: { "sass-formatter@0.8.0": "patches/s.patch" },
        }),
        PLUGINS,
      ),
    ).not.toBe(base);
  });

  test("a configured plugin with no lock entry cannot be compared", () => {
    expect(() => prettierLockSlice(lock(), ["no-such-plugin"])).toThrow(
      /no bun.lock entry/u,
    );
  });

  test("patched or overridden Prettier entries are visible", () => {
    expect(
      prettierLockSlice(
        lock({}, [], { patchedDependencies: { "prettier@3.10.1": "p.patch" } }),
        PLUGINS,
      ),
    ).not.toBe(base);
    expect(
      prettierLockSlice(
        lock({}, [], { overrides: { prettier: "3.10.1" } }),
        PLUGINS,
      ),
    ).not.toBe(base);
  });

  test("a lockfile without packages is rejected", () => {
    expect(() => prettierLockSlice("{}", PLUGINS)).toThrow();
  });
});

describe("prettierToolchainChanged", () => {
  const same = { "bun.lock": lock(), "package.json": manifest() };

  test("compares only the toolchain files the range changed", () => {
    expect(
      prettierToolchainChanged(
        [],
        same,
        { "bun.lock": "not a lockfile", "package.json": "{" },
        PLUGINS,
      ),
    ).toBe(false);
  });

  test("a file missing on either side differs", () => {
    expect(
      prettierToolchainChanged(
        ["bun.lock"],
        same,
        { ...same, "bun.lock": null },
        PLUGINS,
      ),
    ).toBe(true);
  });

  test("an unreadable file cannot be compared", () => {
    expect(
      prettierToolchainChanged(
        ["package.json"],
        same,
        { ...same, "package.json": "{" },
        PLUGINS,
      ),
    ).toBeNull();
  });
});

function plan(directory: string, base: string) {
  return Object.fromEntries(
    SHARD_NAMES.map((shard) => [
      shard,
      changedFilesForShard(
        "prettier",
        shard,
        { CI_CHANGED_BASE: base },
        directory,
      ),
    ]),
  );
}

let repo: TempGitRepo | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await repo?.cleanup();
});

async function history(
  head: Record<string, string>,
  baseFiles: Record<string, string> = {},
): Promise<{ directory: string; base: string }> {
  repo = await createTempGitRepo("prettier-toolchain-");
  const { directory, git } = repo;
  const commit = async (files: Record<string, string>, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      await Bun.write(path.join(directory, file), content);
    }
    await git(["add", "."]);
    await git(["commit", "--quiet", "--no-gpg-sign", "-m", message]);
  };
  await commit(
    {
      "package.json": manifest(),
      "bun.lock": lock(),
      ".prettierrc.json": JSON.stringify({ plugins: PLUGINS }),
      ".gitignore": "node_modules/\n",
      "scripts/tool.ts": "export const tool = 1;\n",
      "packages/alpha/src/index.ts": "export const alpha = 1;\n",
      "packages/scout-for-lol/src/index.ts": "export const scout = 1;\n",
      "packages/homelab/src/index.ts": "export const homelab = 1;\n",
      ...baseFiles,
    },
    "base",
  );
  const base = revision(await git(["rev-parse", "HEAD"]));
  // An intermediate commit proves the diff spans the whole range.
  await commit(
    { "packages/alpha/src/other.ts": "export const o = 1;\n" },
    "mid",
  );
  await commit(head, "head");
  return { directory, base };
}

describe("changedFilesForShard narrows package.json and bun.lock against real history", () => {
  const NEW_PACKAGE = {
    "package.json": manifest({
      scripts: { verify: "x", "e2e:affected": "bun e2e.ts" },
      workspaces: ["packages/new-package"],
    }),
    "bun.lock": lock({
      "brand-new": ["brand-new@1.0.0", "", {}, "sha512-new"],
      turbo: ["turbo@2.12.0", "", {}, "sha512-turbo2"],
    }),
    "packages/new-package/src/index.ts": "export const n = 1;\n",
  };

  test("a new package and an unrelated dependency bump check only the changed files", async () => {
    const { directory, base } = await history(NEW_PACKAGE);
    expect(plan(directory, base)).toEqual({
      scout: [],
      homelab: [],
      packages: [
        "packages/alpha/src/other.ts",
        "packages/new-package/src/index.ts",
      ],
      root: ["bun.lock", "package.json"],
    });
  });

  test("the narrowed run still hashes as a partial run", async () => {
    const { directory, base } = await history(NEW_PACKAGE);
    for (const shard of SHARD_NAMES) {
      expect(
        await prettierChangedDigest(
          shard,
          { CI_CHANGED_BASE: base },
          directory,
        ),
      ).toMatch(/^changed-[a-f0-9]{64}$/u);
    }
  });

  test.each([
    [
      "Prettier version",
      { "bun.lock": lock({ prettier: ["prettier@3.10.2", "", {}, "x"] }) },
    ],
    [
      "plugin dependency",
      { "bun.lock": lock({ suf: ["suf@0.1.1", "", {}, "sha512-suf2"] }) },
    ],
    [
      "package.json Prettier key",
      { "package.json": manifest({ prettier: { semi: false } }) },
    ],
    [
      "Prettier configuration",
      { ".prettierrc.json": JSON.stringify({ semi: false }) },
    ],
    ["root ignore file", { ".gitignore": "node_modules/\ndist/\n" }],
    ["editorconfig", { "packages/alpha/.editorconfig": "root = false\n" }],
    ["Prettier patch", { "patches/prettier@3.10.1.patch": "--- a\n" }],
    [
      "patch to a package that is not named Prettier",
      { "patches/sass-formatter@0.8.0.patch": "--- a\n" },
    ],
    [
      "bun.lock patchedDependencies entry",
      {
        "bun.lock": lock({}, [], {
          patchedDependencies: { "sass-formatter@0.8.0": "patches/s.patch" },
        }),
      },
    ],
    [
      "package.json patchedDependencies entry",
      {
        "package.json": manifest({
          patchedDependencies: { "sass-formatter@0.8.0": "patches/s.patch" },
        }),
      },
    ],
  ])("a %s change checks the complete shard", async (_name, head) => {
    const { directory, base } = await history(head);
    for (const shard of SHARD_NAMES) {
      expect(
        changedFilesForShard(
          "prettier",
          shard,
          { CI_CHANGED_BASE: base },
          directory,
        ),
      ).toBeNull();
    }
  });

  test("a plugin that does not mention Prettier is an input once the configuration names it", async () => {
    repo = await createTempGitRepo("prettier-toolchain-");
    const { directory, git } = repo;
    const write = async (files: Record<string, string>) => {
      for (const [file, content] of Object.entries(files)) {
        await Bun.write(path.join(directory, file), content);
      }
      await git(["add", "."]);
      await git(["commit", "--quiet", "--no-gpg-sign", "-m", "step"]);
    };
    await write({
      "package.json": manifest(),
      "bun.lock": lock(),
      ".prettierrc.json": JSON.stringify({ plugins: ["@acme/fmt"] }),
    });
    const base = revision(await git(["rev-parse", "HEAD"]));
    await write({
      "bun.lock": lock({ "@acme/fmt": ["@acme/fmt@1.1.0", "", {}, "x"] }),
    });
    expect(
      changedFilesForShard(
        "prettier",
        "root",
        { CI_CHANGED_BASE: base },
        directory,
      ),
    ).toBeNull();
  });
});

describe("changedFilesForShard with plugin configuration and unreadable inputs", () => {
  test("an eslint bump and an eslint-config-prettier bump check only the changed files", async () => {
    const { directory, base } = await history({
      "bun.lock": lock({
        eslint: ["eslint@9.1.0", "", {}, "sha512-eslint2"],
        "eslint-config-prettier": [
          "eslint-config-prettier@10.1.0",
          "",
          { peerDependencies: { eslint: ">=7" } },
          "sha512-ecp2",
        ],
      }),
    });
    expect(plan(directory, base)).toEqual({
      scout: [],
      homelab: [],
      packages: ["packages/alpha/src/other.ts"],
      root: ["bun.lock"],
    });
  });

  test("a plugin named in the package.json prettier key, by subpath, is an input", async () => {
    const { directory, base } = await history(
      { "bun.lock": lock({ "@acme/fmt": ["@acme/fmt@1.1.0", "", {}, "x"] }) },
      {
        "package.json": manifest({
          prettier: { plugins: ["@acme/fmt/plugin"] },
        }),
        ".prettierrc.json": "{}",
      },
    );
    expect(
      changedFilesForShard(
        "prettier",
        "root",
        { CI_CHANGED_BASE: base },
        directory,
      ),
    ).toBeNull();
  });

  test.each([
    ["a relative path", "./plugins/local.js"],
    ["an alias with no lock entry", "fmt-alias"],
  ])(
    "a plugin given as %s checks the complete shard and says so",
    async (_name, specifier) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {
        // The warning is the behaviour under test; keep it off the test log.
      });
      const { directory, base } = await history(
        { "bun.lock": lock({ turbo: ["turbo@2.12.0", "", {}, "x"] }) },
        { ".prettierrc.json": JSON.stringify({ plugins: [specifier] }) },
      );
      expect(
        changedFilesForShard(
          "prettier",
          "root",
          { CI_CHANGED_BASE: base },
          directory,
        ),
      ).toBeNull();
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/^WARN: prettier/u),
      );
    },
  );

  test("an unreadable bun.lock checks the complete shard and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      // The warning is the behaviour under test; keep it off the test log.
    });
    const { directory, base } = await history({ "bun.lock": "not a lockfile" });
    expect(
      changedFilesForShard(
        "prettier",
        "root",
        { CI_CHANGED_BASE: base },
        directory,
      ),
    ).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("bun.lock"));
  });

  test("the other checks never treated these files as inputs", async () => {
    const { directory, base } = await history({
      "bun.lock": lock({ prettier: ["prettier@3.10.2", "", {}, "x"] }),
    });
    expect(
      changedFilesForShard(
        "line-endings",
        "root",
        { CI_CHANGED_BASE: base },
        directory,
      ),
    ).toEqual(["bun.lock"]);
  });
});
