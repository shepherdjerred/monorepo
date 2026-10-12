import { expect, test } from "vitest";
import {
  BUN_CACHE,
  BUN_CACHE_CONTROL,
  UV_CACHE,
  bunInstallEnvironment,
  withSharedBunCache,
} from "#src/pipeline/cache.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { credentiallessHostedAutomationSteps } from "#src/pipeline/steps.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { TEST_IMAGES, testPipelineSteps } from "./identity.ts";

const INSTALL = "ci/scripts/bun-install.sh --frozen-lockfile --production";

function installStep(overrides: Partial<CiStep> = {}): CiStep {
  return {
    key: "lane",
    label: "lane",
    image: TEST_IMAGES.base,
    commands: [". ci/scripts/toolchain.sh", INSTALL],
    timeoutMinutes: 5,
    resources: MEDIUM_TIER,
    ...overrides,
  };
}

test("every trusted in-cluster Bun install mounts the shared cache", () => {
  const installing = testPipelineSteps().filter((step) =>
    step.commands.some((command) =>
      command.includes("ci/scripts/bun-install.sh"),
    ),
  );
  expect(installing.length).toBeGreaterThan(10);
  for (const step of installing) {
    expect(bunInstallEnvironment(step.volumes), step.key).toMatchObject({
      BUN_INSTALL_LOCK_MODE: "shared",
    });
  }
});

test("shared cache derivation keeps existing mounts and skips non-installs", () => {
  const tofuCache = { claim: "woodpecker-tofu-plugin-cache", path: "/tofu" };
  expect(
    withSharedBunCache(installStep({ volumes: [tofuCache] })).volumes,
  ).toEqual([tofuCache, BUN_CACHE, BUN_CACHE_CONTROL]);
  const mounted = installStep({ volumes: [BUN_CACHE, BUN_CACHE_CONTROL] });
  expect(withSharedBunCache(mounted)).toBe(mounted);
  const noInstall = installStep({ commands: ["echo ok"] });
  expect(withSharedBunCache(noInstall)).toBe(noInstall);
  const host = installStep({ backend: "local" });
  expect(withSharedBunCache(host)).toBe(host);
  const ordered = withSharedBunCache(
    installStep({
      commands: ["echo setup"],
      orderedSteps: [
        installStep({ key: "inner" }),
        installStep({ key: "plain", commands: ["echo ok"] }),
      ],
    }),
  );
  expect(ordered.volumes).toBeUndefined();
  expect(ordered.orderedSteps?.map((command) => command.volumes)).toEqual([
    [BUN_CACHE, BUN_CACHE_CONTROL],
    undefined,
  ]);
});

test("credentialless hosted automation never mounts shared caches", () => {
  for (const step of credentiallessHostedAutomationSteps(TEST_IMAGES)) {
    expect(step.volumes ?? [], step.key).toEqual([]);
  }
});

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
