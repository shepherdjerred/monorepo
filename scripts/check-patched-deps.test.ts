import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import {
  collectErrors,
  packagesSection,
  resolvedVersionsByName,
} from "./check-patched-deps.ts";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

describe("packagesSection", () => {
  test("excludes the patchedDependencies echo", () => {
    const lock = `{
  "lockfileVersion": 1,
  "patchedDependencies": {
    "stale@1.0.0": "patches/stale@1.0.0.patch",
  },
  "packages": {
    "fresh": ["fresh@2.0.0", "", {}, "sha512-x"],
  },
}`;
    const section = packagesSection(lock);
    expect(section).toContain("fresh@2.0.0");
    expect(section).not.toContain("stale@1.0.0");
  });

  test("brace-matching survives braces inside strings", () => {
    const lock = `{
  "packages": {
    "weird": ["weird@1.0.0", "", { "bin": "{oops}" }, "sha512-y"],
  },
  "patchedDependencies": { "weird@9.9.9": "patches/x.patch" },
}`;
    expect(packagesSection(lock)).not.toContain("9.9.9");
  });
});

describe("resolvedVersionsByName", () => {
  test("collects registry versions and skips workspace members", () => {
    const lock = `{
  "packages": {
    "a": ["a@1.0.0", "", {}, "sha512-a"],
    "x/a": ["a@2.0.0", "", {}, "sha512-a2"],
    "pkg": ["pkg@workspace:packages/pkg"],
  },
}`;
    const byName = resolvedVersionsByName(lock);
    expect([...(byName.get("a") ?? [])].sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(byName.has("pkg")).toBe(false);
  });
});

describe("collectErrors against the real repo", () => {
  // THE regression this check exists for: a patch keyed to a version nothing
  // resolves must be reported even though bun.lock echoes the key verbatim
  // in its own patchedDependencies section.
  test("a stale key is reported despite the lockfile echo", async () => {
    const dir = `${tmpdir()}/check-patched-deps-test-${String(process.pid)}`;
    const real = await Bun.file(`${REPO_ROOT}/package.json`).json();
    const manifest: unknown = real;
    if (typeof manifest !== "object" || manifest === null) {
      throw new Error("unreachable");
    }
    const patched = {
      "twisted@0.0.1-never": "patches/twisted@0.0.1-never.patch",
    };
    const doctored = { ...manifest, patchedDependencies: patched };
    // The doctored lock echoes the stale key exactly like bun does.
    const lock = `{
  "patchedDependencies": {
    "twisted@0.0.1-never": "patches/twisted@0.0.1-never.patch",
  },
  "packages": {
    "twisted": ["twisted@1.82.0", "", {}, "sha512-t"],
  },
}`;
    await Bun.write(`${dir}/package.json`, JSON.stringify(doctored));
    await Bun.write(`${dir}/bun.lock`, lock);
    await Bun.write(`${dir}/patches/.keep`, "");
    try {
      const errors = await collectErrors(dir);
      expect(
        errors.some((e) => e.includes("matches NO resolved package")),
      ).toBe(true);
      expect(errors.some((e) => e.includes("also resolves"))).toBe(true);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });

  test("the live repo passes", async () => {
    expect(await collectErrors(REPO_ROOT)).toEqual([]);
  });
});
