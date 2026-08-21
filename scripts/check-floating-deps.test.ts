import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  classifySpec,
  collectErrors,
  manifestErrors,
  readWorkspacePatterns,
} from "./check-floating-deps.ts";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

function reason(spec: string): string {
  const verdict = classifySpec(spec);
  if (verdict.ok) throw new Error(`expected "${spec}" to be rejected`);
  return verdict.reason;
}

describe("classifySpec", () => {
  test("accepts version-anchored ranges", () => {
    for (const spec of [
      "1.4.0",
      "1.4.0",
      "~1.3",
      "^1",
      ">=2.0.0 <3.0.0",
      "1.x",
      "v1.2.3",
      "1.0.0-rc.1",
      "0.0.104",
    ]) {
      expect(classifySpec(spec)).toEqual({ ok: true });
    }
  });

  test("accepts protocols the checkout pins", () => {
    for (const spec of [
      "workspace:*",
      "file:../eslint-config",
      "link:../thing",
    ]) {
      expect(classifySpec(spec)).toEqual({ ok: true });
    }
  });

  // THE regression: `latest` is a mutable registry pointer, so the registry
  // — not the lockfile — decides what installs.
  test("rejects dist-tags, including ones nobody has invented yet", () => {
    expect(reason("latest")).toContain("mutable npm dist-tag");
    expect(reason("next")).toContain("mutable npm dist-tag");
    expect(reason("canary")).toContain("mutable npm dist-tag");
    expect(reason("some-future-tag")).toContain("mutable npm dist-tag");
  });

  test("rejects unbounded wildcards and empty specs", () => {
    expect(reason("*")).toContain("matches every published version");
    expect(reason("x")).toContain("matches every published version");
    expect(reason("")).toContain("resolves to any published version");
    expect(reason("   ")).toContain("resolves to any published version");
  });

  test("unwraps npm: aliases and judges the target", () => {
    expect(classifySpec("npm:typescript@7.0.2")).toEqual({ ok: true });
    expect(classifySpec("npm:@babel/core@7.28.0")).toEqual({ ok: true });
    expect(reason("npm:typescript@latest")).toContain(
      "alias target is not pinned",
    );
    expect(reason("npm:typescript")).toContain("names no version");
  });
});

describe("manifestErrors", () => {
  test("reports the field and dependency name of each floating spec", () => {
    const errors = manifestErrors(
      "packages/demo/package.json",
      JSON.stringify({
        dependencies: { pinned: "^1.0.0" },
        devDependencies: { "bun-types": "latest" },
        peerDependencies: { anything: "*" },
      }),
    );
    expect(errors).toEqual([
      'packages/demo/package.json devDependencies.bun-types: "latest" is a mutable npm dist-tag — pin a version range so the lockfile controls resolution',
      'packages/demo/package.json peerDependencies.anything: "*" matches every published version',
    ]);
  });

  test("rejects a non-string spec rather than skipping it", () => {
    expect(() =>
      manifestErrors(
        "packages/demo/package.json",
        JSON.stringify({ dependencies: { broken: 1 } }),
      ),
    ).toThrow("dependencies.broken must be a string");
  });
});

describe("readWorkspacePatterns", () => {
  test("requires an array of strings", () => {
    expect(() => readWorkspacePatterns(JSON.stringify({}))).toThrow(
      "workspaces must be an array",
    );
    expect(() =>
      readWorkspacePatterns(JSON.stringify({ workspaces: [1] })),
    ).toThrow("entries must be strings");
  });
});

describe("collectErrors", () => {
  test("scans the root manifest and every workspace member, including globbed ones", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "check-floating-deps-"));
    try {
      await Bun.write(
        path.join(dir, "package.json"),
        JSON.stringify({
          devDependencies: { "root-dep": "beta" },
          workspaces: ["packages/explicit", "packages/globbed/*"],
        }),
      );
      await Bun.write(
        path.join(dir, "packages/explicit/package.json"),
        JSON.stringify({ dependencies: { fine: "^2.0.0" } }),
      );
      await Bun.write(
        path.join(dir, "packages/globbed/inner/package.json"),
        JSON.stringify({ devDependencies: { "bun-types": "latest" } }),
      );

      expect(await collectErrors(dir)).toEqual([
        'package.json devDependencies.root-dep: "beta" is a mutable npm dist-tag — pin a version range so the lockfile controls resolution',
        'packages/globbed/inner/package.json devDependencies.bun-types: "latest" is a mutable npm dist-tag — pin a version range so the lockfile controls resolution',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports a workspace member listed but absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "check-floating-deps-"));
    try {
      await Bun.write(
        path.join(dir, "package.json"),
        JSON.stringify({ workspaces: ["packages/ghost"] }),
      );
      expect(await collectErrors(dir)).toEqual([
        "packages/ghost/package.json is listed in root workspaces but does not exist",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the live repo passes", async () => {
    expect(await collectErrors(REPO_ROOT)).toEqual([]);
  });
});
