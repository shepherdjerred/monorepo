import { expect, test } from "vitest";
import {
  BUN_CACHE,
  BUN_CACHE_CONTROL,
  UV_CACHE,
  bunInstallEnvironment,
} from "#src/pipeline/cache.ts";

test("download caches are explicitly directed to their mounted volumes", () => {
  expect(
    bunInstallEnvironment([BUN_CACHE, BUN_CACHE_CONTROL, UV_CACHE]),
  ).toEqual({
    BUN_INSTALL_LOCK_MODE: "shared",
    BUN_INSTALL_CACHE_DIR: "/woodpecker/bun-cache/data",
    BUN_CACHE_LOCK_FILE: "/woodpecker/bun-cache-control/.gc.lock",
    UV_CACHE_DIR: "/woodpecker/uv-cache",
  });
});

test("unmounted caches do not receive shared paths", () => {
  expect(bunInstallEnvironment(undefined)).toEqual({
    BUN_INSTALL_LOCK_MODE: "local",
  });
  expect(bunInstallEnvironment([UV_CACHE])).toEqual({
    BUN_INSTALL_LOCK_MODE: "local",
    UV_CACHE_DIR: UV_CACHE.path,
  });
});

test("partial and misdirected cache mounts fail generation", () => {
  for (const volumes of [
    [BUN_CACHE],
    [BUN_CACHE_CONTROL],
    [{ ...BUN_CACHE, path: "/wrong" }, BUN_CACHE_CONTROL],
    [BUN_CACHE, { ...BUN_CACHE_CONTROL, path: "/wrong" }],
    [{ ...UV_CACHE, path: "/wrong" }],
  ])
    expect(() => bunInstallEnvironment(volumes)).toThrow();
});
