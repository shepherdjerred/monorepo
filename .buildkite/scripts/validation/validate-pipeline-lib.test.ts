import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertInstallFreeEntrypointsHaveNoBareImports,
  assertPackageTokens,
  assertUnfilteredInstallBelongsToVerify,
  collectStepBlocks,
  FORBIDDEN_DOCKER_IN_DOCKER_PATTERNS,
  completePodReservation,
  type PodReservation,
} from "./validate-pipeline-lib.ts";

const nativeStepConfig = {
  sharedPodAnchors: [],
  checkoutContainerAlias: "- *checkout_container",
  pathGatedPrKeys: new Set<string>(),
  nativeStepKeys: new Set(["quotabar-macos-pr", "tasknotes-native-main"]),
  globalIfChanged: [],
};

const validNativeStep = `  - label: native
    key: quotabar-macos-pr
    timeout_in_minutes: 45
    if: build.pull_request.id != null
    depends_on: verify
    concurrency: 1
    concurrency_group: monorepo/macos-native
    command: run-native
    agents:
      queue: macos
`;

function validateNativeStep(source: string): void {
  collectStepBlocks(source.split("\n"), nativeStepConfig);
}

describe("native Buildkite execution surface", () => {
  test("accepts a hard serialized macOS step", () => {
    expect(() => validateNativeStep(validNativeStep)).not.toThrow();
  });

  test.each([
    ["missing queue", "      queue: macos\n", ""],
    ["wrong queue", "queue: macos", "queue: default"],
  ])("rejects %s", (_name, target, replacement) => {
    expect(() =>
      validateNativeStep(validNativeStep.replace(target, replacement)),
    ).toThrow("must target queue macos");
  });

  test("rejects Kubernetes plugins", () => {
    const source = validNativeStep.replace(
      "    agents:",
      "    plugins:\n      - kubernetes: {}\n    agents:",
    );
    expect(() => validateNativeStep(source)).toThrow(
      "must be a hard step without plugins",
    );
  });

  test("rejects soft-fail configuration", () => {
    const source = validNativeStep.replace(
      "    command:",
      "    soft_fail: true\n    command:",
    );
    expect(() => validateNativeStep(source)).toThrow("must be a hard step");
  });

  test("rejects missing global serialization", () => {
    const source = validNativeStep.replace(
      "    concurrency: 1\n    concurrency_group: monorepo/macos-native\n",
      "",
    );
    expect(() => validateNativeStep(source)).toThrow(
      "must serialize in monorepo/macos-native",
    );
  });
});

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

describe("Bun install cache-lock guard", () => {
  test("accepts the one unfiltered wrapper invocation in verify", () => {
    const lines = [
      "  - label: verify",
      "    key: verify",
      "    command: |",
      "      .buildkite/scripts/bun-install.sh --frozen-lockfile",
    ];

    expect(() =>
      assertUnfilteredInstallBelongsToVerify(lines, [0]),
    ).not.toThrow();
  });

  test("rejects direct Bun installs that bypass the shared cache lock", () => {
    const lines = [
      "  - label: verify",
      "    key: verify",
      "    command: |",
      "      bun install --frozen-lockfile",
    ];

    expect(() => assertUnfilteredInstallBelongsToVerify(lines, [0])).toThrow(
      "all installs must use .buildkite/scripts/bun-install.sh",
    );
  });
});

describe("complete Buildkite pod reservations", () => {
  test("includes the agent and checkout containers for every audited pod type", () => {
    const cases: {
      name: string;
      command: PodReservation;
      additionalContainers?: PodReservation[];
      expected: PodReservation;
    }[] = [
      {
        name: "Verify",
        command: { cpuMilli: 1000, memoryMi: 14_336 },
        expected: { cpuMilli: 1100, memoryMi: 15_424 },
      },
      {
        name: "Playwright",
        command: { cpuMilli: 1000, memoryMi: 4096 },
        expected: { cpuMilli: 1100, memoryMi: 5184 },
      },
      {
        name: "Image/BuildKit client",
        command: { cpuMilli: 1000, memoryMi: 1024 },
        expected: { cpuMilli: 1100, memoryMi: 2112 },
      },
      {
        name: "PR dry-run",
        command: { cpuMilli: 250, memoryMi: 768 },
        expected: { cpuMilli: 350, memoryMi: 1856 },
      },
      ...["ArgoCD sync", "Semgrep/Trivy", "light/OpenTofu"].map((name) => ({
        name,
        command: { cpuMilli: 250, memoryMi: 512 },
        expected: { cpuMilli: 350, memoryMi: 1600 },
      })),
      ...["Normal", "Resume"].map((name) => ({
        name,
        command: { cpuMilli: 1000, memoryMi: 2048 },
        expected: { cpuMilli: 1100, memoryMi: 3136 },
      })),
      {
        name: "alert-dashboard-sqlite",
        command: { cpuMilli: 1000, memoryMi: 2048 },
        expected: { cpuMilli: 1100, memoryMi: 3136 },
      },
    ];

    for (const podType of cases) {
      expect(
        completePodReservation(podType.command, podType.additionalContainers),
        podType.name,
      ).toEqual(podType.expected);
    }
  });
});

async function withModules(
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "install-free-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      await Bun.write(path.join(root, name), source);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function step(command: string): ReadonlyMap<string, string> {
  return new Map([["images-pr", `  - label: x\n    command: |\n${command}`]]);
}

describe("install-free entrypoint imports", () => {
  test("accepts a closure of relative modules and runtime builtins", async () => {
    await withModules(
      {
        "entry.ts": 'import { helper } from "./helper.ts";\nexport { helper };',
        "helper.ts":
          'import { rm } from "node:fs/promises";\nimport { $ } from "bun";\nexport const helper = { rm, $ };',
      },
      async (root) => {
        await assertInstallFreeEntrypointsHaveNoBareImports(
          step(`      bun --no-install ${path.join(root, "entry.ts")}`),
        );
      },
    );
  });

  test("rejects a bare package reached transitively", async () => {
    await withModules(
      {
        "entry.ts": 'import { schema } from "./deep.ts";\nexport { schema };',
        "deep.ts": 'import { z } from "zod";\nexport const schema = z;',
      },
      async (root) => {
        await expect(
          assertInstallFreeEntrypointsHaveNoBareImports(
            step(`      bun --no-install ${path.join(root, "entry.ts")}`),
          ),
        ).rejects.toThrow(/deep\.ts imports the bare package "zod"/);
      },
    );
  });

  test("ignores entrypoints that run after the lane installs", async () => {
    await withModules(
      { "entry.ts": 'import { z } from "zod";\nexport const schema = z;' },
      async (root) => {
        await assertInstallFreeEntrypointsHaveNoBareImports(
          step(
            [
              "      .buildkite/scripts/bun-install.sh --frozen-lockfile",
              `      bun --no-install ${path.join(root, "entry.ts")}`,
            ].join("\n"),
          ),
        );
      },
    );
  });

  test("does not mistake a --cache-from argument for an import", async () => {
    await withModules(
      {
        "entry.ts": [
          "export const args = [",
          '  "--cache-from",',
          "  `type=registry,ref=${image}:buildcache`,",
          "];",
          "declare const image: string;",
        ].join("\n"),
      },
      async (root) => {
        await assertInstallFreeEntrypointsHaveNoBareImports(
          step(`      bun --no-install ${path.join(root, "entry.ts")}`),
        );
      },
    );
  });
});
