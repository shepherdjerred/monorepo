import { expect, test } from "vitest";
import {
  BUN_CACHE,
  BUN_CACHE_CONTROL,
  CARGO_CACHE,
  GO_CACHE,
  GRADLE_HOME,
  SCCACHE,
  TOOL_CACHE,
  UV_CACHE,
  sharedCacheEnvironment,
  withSharedBunCache,
  withSharedToolCaches,
} from "#src/pipeline/cache.ts";
import type { CiCommandStep, CiStep } from "#src/pipeline/model.ts";
import { credentiallessHostedAutomationSteps } from "#src/pipeline/steps.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { TEST_IMAGES, testPipelineSteps } from "./identity.ts";

const INSTALL = "ci/scripts/bun-install.sh --frozen-lockfile --production";
const FULL_TOOLCHAIN = ". ci/scripts/toolchain.sh";
const NARROW_TOOLCHAIN =
  "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh";

function installStep(overrides: Partial<CiStep> = {}): CiStep {
  return {
    key: "lane",
    label: "lane",
    image: TEST_IMAGES.base,
    commands: [FULL_TOOLCHAIN, INSTALL],
    timeoutMinutes: 5,
    resources: MEDIUM_TIER,
    ...overrides,
  };
}

const claims = (step: CiCommandStep) =>
  step.volumes?.map((volume) => volume.claim);

test("every trusted in-cluster Bun install mounts the shared cache", () => {
  const installing = testPipelineSteps().filter((step) =>
    step.commands.some((command) =>
      command.includes("ci/scripts/bun-install.sh"),
    ),
  );
  expect(installing.length).toBeGreaterThan(10);
  for (const step of installing) {
    expect(sharedCacheEnvironment(step.volumes), step.key).toMatchObject({
      BUN_INSTALL_LOCK_MODE: "shared",
    });
  }
});

test("every trusted toolchain container mounts the tool cache; full scopes mount every toolchain cache", () => {
  const steps = testPipelineSteps().filter((step) =>
    step.commands.some((command) =>
      command.includes("ci/scripts/toolchain.sh"),
    ),
  );
  expect(steps.length).toBeGreaterThan(10);
  for (const step of steps) {
    expect(claims(step), step.key).toContain(TOOL_CACHE.claim);
    const narrow = step.commands.every(
      (command) =>
        !command.includes("ci/scripts/toolchain.sh") ||
        command.includes("MISE_TOOLCHAIN_SCOPE="),
    );
    for (const cache of [
      CARGO_CACHE,
      SCCACHE,
      GO_CACHE,
      GRADLE_HOME,
      UV_CACHE,
    ]) {
      if (narrow) expect(claims(step), step.key).not.toContain(cache.claim);
      else expect(claims(step), step.key).toContain(cache.claim);
    }
  }
  const verify = testPipelineSteps().find((step) => step.key === "verify");
  expect(verify).toBeDefined();
  expect(sharedCacheEnvironment(verify?.volumes)).toMatchObject({
    RUSTC_WRAPPER: "sccache",
    GOMODCACHE: "/woodpecker/go-cache/mod",
    GRADLE_USER_HOME: "/woodpecker/gradle-home",
    UV_PYTHON_INSTALL_DIR: "/woodpecker/uv-cache/python",
    BUN_INSTALL: "/woodpecker/tool-cache/bun",
  });
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

test("toolchain caches follow the toolchain scope of each container", () => {
  const full = withSharedToolCaches(installStep());
  expect(claims(full)).toEqual([
    TOOL_CACHE.claim,
    CARGO_CACHE.claim,
    SCCACHE.claim,
    GO_CACHE.claim,
    GRADLE_HOME.claim,
    UV_CACHE.claim,
  ]);
  const narrow = withSharedToolCaches(
    installStep({ commands: [NARROW_TOOLCHAIN, INSTALL] }),
  );
  expect(claims(narrow)).toEqual([TOOL_CACHE.claim]);
  const none = installStep({ commands: ["echo ok"] });
  expect(withSharedToolCaches(none)).toBe(none);
  const host = installStep({ backend: "local" });
  expect(withSharedToolCaches(host)).toBe(host);
  const already = installStep({ volumes: [TOOL_CACHE] });
  expect(claims(withSharedToolCaches(already))).toEqual([
    TOOL_CACHE.claim,
    CARGO_CACHE.claim,
    SCCACHE.claim,
    GO_CACHE.claim,
    GRADLE_HOME.claim,
    UV_CACHE.claim,
  ]);
  const ordered = withSharedToolCaches(
    installStep({
      commands: ["echo setup"],
      orderedSteps: [
        installStep({ key: "inner", commands: [NARROW_TOOLCHAIN] }),
      ],
    }),
  );
  expect(ordered.volumes).toBeUndefined();
  expect(ordered.orderedSteps?.map((command) => claims(command))).toEqual([
    [TOOL_CACHE.claim],
  ]);
});

test("credentialless hosted automation never mounts shared caches", () => {
  for (const step of credentiallessHostedAutomationSteps(TEST_IMAGES)) {
    expect(step.volumes ?? [], step.key).toEqual([]);
  }
});

test("download caches are explicitly directed to their mounted volumes", () => {
  expect(
    sharedCacheEnvironment([BUN_CACHE, BUN_CACHE_CONTROL, UV_CACHE]),
  ).toEqual({
    BUN_INSTALL_LOCK_MODE: "shared",
    BUN_INSTALL_CACHE_DIR: "/woodpecker/bun-cache/data",
    BUN_CACHE_LOCK_FILE: "/woodpecker/bun-cache-control/.gc.lock",
    UV_CACHE_DIR: "/woodpecker/uv-cache",
    UV_PYTHON_INSTALL_DIR: "/woodpecker/uv-cache/python",
  });
  expect(
    sharedCacheEnvironment([
      CARGO_CACHE,
      SCCACHE,
      GO_CACHE,
      TOOL_CACHE,
      GRADLE_HOME,
    ]),
  ).toEqual({
    BUN_INSTALL_LOCK_MODE: "local",
    CI_CARGO_CACHE_DIR: "/woodpecker/cargo-cache",
    RUSTC_WRAPPER: "sccache",
    SCCACHE_DIR: "/woodpecker/sccache",
    SCCACHE_CACHE_SIZE: "30G",
    CARGO_INCREMENTAL: "0",
    GOMODCACHE: "/woodpecker/go-cache/mod",
    GOCACHE: "/woodpecker/go-cache/build",
    GOLANGCI_LINT_CACHE: "/woodpecker/go-cache/golangci-lint",
    XDG_CACHE_HOME: "/woodpecker/tool-cache/xdg",
    NUGET_PACKAGES: "/woodpecker/tool-cache/nuget",
    BUN_INSTALL: "/woodpecker/tool-cache/bun",
    GRADLE_USER_HOME: "/woodpecker/gradle-home",
  });
});

test("unmounted caches do not receive shared paths", () => {
  expect(sharedCacheEnvironment(undefined)).toEqual({
    BUN_INSTALL_LOCK_MODE: "local",
  });
  expect(sharedCacheEnvironment([UV_CACHE])).toEqual({
    BUN_INSTALL_LOCK_MODE: "local",
    UV_CACHE_DIR: UV_CACHE.path,
    UV_PYTHON_INSTALL_DIR: `${UV_CACHE.path}/python`,
  });
});

test("partial and misdirected cache mounts fail generation", () => {
  for (const volumes of [
    [BUN_CACHE],
    [BUN_CACHE_CONTROL],
    [{ ...BUN_CACHE, path: "/wrong" }, BUN_CACHE_CONTROL],
    [BUN_CACHE, { ...BUN_CACHE_CONTROL, path: "/wrong" }],
    [{ ...UV_CACHE, path: "/wrong" }],
    [{ ...SCCACHE, path: "/wrong" }],
    [{ ...TOOL_CACHE, path: "/wrong" }],
  ])
    expect(() => sharedCacheEnvironment(volumes)).toThrow();
});
