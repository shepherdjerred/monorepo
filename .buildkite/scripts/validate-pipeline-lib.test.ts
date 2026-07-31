import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertPackageTokens,
  FORBIDDEN_DOCKER_IN_DOCKER_PATTERNS,
} from "./validate-pipeline-lib.ts";

function hasForbiddenDockerInDockerPath(source: string): boolean {
  return FORBIDDEN_DOCKER_IN_DOCKER_PATTERNS.some((pattern) =>
    pattern.test(source),
  );
}

const nativeTypeScriptDependency =
  '"@typescript/native": "npm:typescript@7.0.2"';
const nativeTypeScriptCommands = [
  "bun node_modules/@typescript/native/bin/tsc --noEmit",
  "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
] as const;

async function withPackageManifest(
  manifest: Readonly<Record<string, unknown>>,
  run: (manifestPath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "validate-pipeline-package-"),
  );
  const manifestPath = `${directory}/package.json`;
  try {
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
    await run(manifestPath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function validateNativeTypeScriptPackage(manifestPath: string): Promise<void> {
  return assertPackageTokens([
    [manifestPath, [nativeTypeScriptDependency], nativeTypeScriptCommands],
  ]);
}

describe("Docker-in-Docker pipeline guard", () => {
  test("rejects canonical and versioned DinD image tags", () => {
    expect(hasForbiddenDockerInDockerPath('image: "docker:dind"')).toBe(true);
    expect(hasForbiddenDockerInDockerPath('image: "docker:29-dind"')).toBe(
      true,
    );
    expect(
      hasForbiddenDockerInDockerPath('image: "docker:29.1-dind-rootless"'),
    ).toBe(true);
  });

  test("allows a regular Docker CLI image", () => {
    expect(hasForbiddenDockerInDockerPath('image: "docker:29"')).toBe(false);
  });
});

describe("CI package tool dependency guard", () => {
  test("accepts the designated native TypeScript command", async () => {
    await withPackageManifest(
      {
        scripts: {
          typecheck: "bun node_modules/@typescript/native/bin/tsc --noEmit",
        },
        devDependencies: {
          "@typescript/native": "npm:typescript@7.0.2",
          typescript: "^6.0.3",
        },
      },
      async (manifestPath) => {
        await expect(
          validateNativeTypeScriptPackage(manifestPath),
        ).resolves.toBeUndefined();
      },
    );
  });

  test("accepts the declared native TypeScript alias selected through PATH", async () => {
    await withPackageManifest(
      {
        scripts: {
          typecheck:
            "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
        },
        devDependencies: {
          "@typescript/native": "npm:typescript@7.0.2",
          typescript: "^6.0.3",
        },
      },
      async (manifestPath) => {
        await expect(
          validateNativeTypeScriptPackage(manifestPath),
        ).resolves.toBeUndefined();
      },
    );
  });

  test("rejects a native compiler invocation without its alias dependency", async () => {
    await withPackageManifest(
      {
        scripts: {
          typecheck:
            "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
        },
        devDependencies: {
          typescript: "^6.0.3",
        },
      },
      async (manifestPath) => {
        await expect(
          validateNativeTypeScriptPackage(manifestPath),
        ).rejects.toThrow(
          `[validate-pipeline] CI package ${manifestPath} is missing explicit tool dependency ${nativeTypeScriptDependency}`,
        );
      },
    );
  });

  test("rejects an undeclared TypeScript tool invocation", async () => {
    await withPackageManifest(
      {
        scripts: {
          typecheck: "bunx --no-install tsc --noEmit",
        },
        devDependencies: {
          "@typescript/native": "npm:typescript@7.0.2",
          typescript: "^6.0.3",
        },
      },
      async (manifestPath) => {
        await expect(
          validateNativeTypeScriptPackage(manifestPath),
        ).rejects.toThrow(
          `[validate-pipeline] CI package ${manifestPath} has invalid scripts.typecheck command "bunx --no-install tsc --noEmit"; expected ${nativeTypeScriptCommands.join(" or ")}`,
        );
      },
    );
  });

  test("rejects an invalid typecheck even when another script uses the native compiler", async () => {
    await withPackageManifest(
      {
        scripts: {
          native:
            "bun node_modules/@typescript/native/bin/tsc --noEmit --pretty",
          typecheck: "bunx --no-install tsc --noEmit",
        },
        devDependencies: {
          "@typescript/native": "npm:typescript@7.0.2",
          typescript: "^6.0.3",
        },
      },
      async (manifestPath) => {
        await expect(
          validateNativeTypeScriptPackage(manifestPath),
        ).rejects.toThrow(
          `[validate-pipeline] CI package ${manifestPath} has invalid scripts.typecheck command "bunx --no-install tsc --noEmit"; expected ${nativeTypeScriptCommands.join(" or ")}`,
        );
      },
    );
  });
});
