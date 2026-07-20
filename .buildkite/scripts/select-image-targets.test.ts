import { describe, expect, test } from "bun:test";

import {
  ALL_IMAGE_TARGETS,
  selectImageTargets,
} from "./select-image-targets.ts";

describe("selectImageTargets", () => {
  test("selects a standalone application image", async () => {
    expect(
      await selectImageTargets(["packages/tasknotes-server/src/index.ts"]),
    ).toEqual(["tasknotes-server"]);
  });

  test("selects consumers of a shared workspace dependency", async () => {
    const targets = await selectImageTargets([
      "packages/llm-models/src/models.ts",
    ]);
    expect(targets).toContain("scout-for-lol");
    expect(targets).toContain("temporal-worker");
  });

  test("selects nested game families without an always-on fallback", async () => {
    expect(
      await selectImageTargets([
        "packages/discord-plays-pokemon/wasm-src/patches/example.patch",
      ]),
    ).toEqual(["discord-plays-pokemon"]);
    expect(
      await selectImageTargets([
        "packages/discord-plays-mario-kart/wasm-src/src/main.cpp",
      ]),
    ).toEqual(["discord-plays-mario-kart"]);
  });

  test("groups the homelab image family", async () => {
    expect(
      await selectImageTargets([
        "packages/homelab/images/caddy-s3proxy/Dockerfile",
      ]),
    ).toEqual(["infra"]);
  });

  test("selects explicit Docker inputs outside workspace dependencies", async () => {
    expect(
      await selectImageTargets(["packages/toolkit/src/commands/pr.ts"]),
    ).toEqual(["temporal-worker"]);
  });

  test("selects every image for shared installation inputs", async () => {
    expect(await selectImageTargets(["bun.lock"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await selectImageTargets([".buildkite/pipeline.yml"])).toEqual(
      ALL_IMAGE_TARGETS,
    );
    expect(await selectImageTargets([".mise.toml"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await selectImageTargets(["packages/resume/package.json"])).toEqual(
      ALL_IMAGE_TARGETS,
    );
  });

  test("selects nothing for unrelated documentation", async () => {
    expect(
      await selectImageTargets(["packages/docs/guides/example.md"]),
    ).toEqual([]);
  });
});
