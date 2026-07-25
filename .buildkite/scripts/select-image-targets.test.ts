import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALL_IMAGE_TARGETS,
  changedPathsSince,
  selectImageTargets,
} from "./select-image-targets.ts";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

function select(changedPaths: readonly string[]): Promise<string[]> {
  return selectImageTargets(changedPaths, REPO_ROOT);
}

describe("selectImageTargets", () => {
  test("selects a standalone application image", async () => {
    expect(await select(["packages/tasknotes-server/src/index.ts"])).toEqual([
      "tasknotes-server",
    ]);
  });

  test("selects consumers of a shared workspace dependency", async () => {
    const targets = await select(["packages/llm-models/src/models.ts"]);
    expect(targets).toContain("scout-for-lol");
    expect(targets).toContain("temporal-worker");
  });

  test("selects nested game families without an always-on fallback", async () => {
    expect(
      await select([
        "packages/discord-plays-pokemon/wasm-src/patches/example.patch",
      ]),
    ).toEqual(["discord-plays-pokemon"]);
    expect(
      await select(["packages/discord-plays-mario-kart/wasm-src/src/main.cpp"]),
    ).toEqual(["discord-plays-mario-kart"]);
  });

  test("groups the homelab image family", async () => {
    expect(
      await select(["packages/homelab/images/caddy-s3proxy/Dockerfile"]),
    ).toEqual(["infra"]);
  });

  test("rebuilds infra when the generated Caddyfile changes", async () => {
    for (const path of [
      "packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts",
      "packages/homelab/src/cdk8s/src/misc/common.ts",
      "packages/homelab/src/cdk8s/src/misc/s3-static-site.ts",
      "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
    ]) {
      expect(await select([path])).toEqual(["infra"]);
    }
  });

  test("selects explicit Docker inputs outside workspace dependencies", async () => {
    expect(await select(["packages/toolkit/src/commands/pr.ts"])).toEqual([
      "temporal-worker",
    ]);
  });

  test("selects every image for shared build inputs", async () => {
    expect(await select(["bun.lock"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await select([".buildkite/pipeline.yml"])).toEqual(
      ALL_IMAGE_TARGETS,
    );
    expect(await select([".mise.toml"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await select(["turbo.json"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await select(["tsconfig.base.json"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await select(["packages/resume/package.json"])).toEqual(
      ALL_IMAGE_TARGETS,
    );
    expect(await select(["scripts/package.json"])).toEqual(ALL_IMAGE_TARGETS);
  });

  test("selects Scout for its shared base TypeScript config", async () => {
    expect(await select(["packages/scout-for-lol/tsconfig.base.json"])).toEqual(
      ["scout-for-lol"],
    );
  });

  test("selects nothing for unrelated documentation", async () => {
    expect(await select(["packages/docs/guides/example.md"])).toEqual([]);
  });
});

function runGit(repoRoot: string, args: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

describe("changedPathsSince", () => {
  test("reports both sides of a rename so the source image is rebuilt", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "ci-image-rename-"));
    try {
      runGit(fixture, ["init", "-q"]);
      runGit(fixture, ["config", "user.email", "ci-selector@example.invalid"]);
      runGit(fixture, ["config", "user.name", "CI selector test"]);
      await Bun.write(`${fixture}/source.ts`, "source\n");
      runGit(fixture, ["add", "source.ts"]);
      runGit(fixture, ["commit", "-qm", "baseline"]);
      const baseResult = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
        cwd: fixture,
        stdout: "pipe",
      });
      const base = new TextDecoder().decode(baseResult.stdout).trim();
      await mkdir(`${fixture}/packages/docs`, { recursive: true });
      runGit(fixture, ["mv", "source.ts", "packages/docs/source.ts"]);
      runGit(fixture, ["commit", "-qm", "rename"]);

      expect(await changedPathsSince(base, fixture)).toEqual([
        "packages/docs/source.ts",
        "source.ts",
      ]);
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });
});
