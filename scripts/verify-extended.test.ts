import { describe, expect, test } from "vitest";
import {
  EXTENDED_CONCURRENCY,
  EXTENDED_TASK,
  EXTENDED_VITEST_MAX_WORKERS,
  extendedEnvironment,
  extendedRuntimeMiseToolsChanged,
  extendedTurboCommand,
  main,
  resolveExtendedForwardedArgs,
  type ExtendedGitRangeReader,
} from "./verify-extended.ts";
import { VERIFY_CONCURRENCY } from "./verify.ts";

const BASE_MISE_TOML = `
# Mise toolchain configuration
[tools]
bun = "1.4.5"
node = "24.22.3"
python = "3.15.2"
rust = "1.100.0"
dotnet = "10.0.404"
java = "corretto-25.0.5.1.2"
gradle = "9.9.2"
"aqua:ip7z/7zip" = "26.06"
"github:theseus-rs/postgresql-binaries" = { version = "18.7.0", strip_components = 1, bin_path = "bin" }
lychee = "0.24.2"
argocd = "3.6.2"
gh = "2.105.0"
`;

function fakeReader(options: {
  changedFiles?: readonly string[] | undefined;
  baseMise?: string;
  targetMise?: string;
}): ExtendedGitRangeReader {
  return {
    readChangedFiles: () => Promise.resolve(options.changedFiles),
    readMiseTomlPair: () =>
      options.baseMise === undefined || options.targetMise === undefined
        ? Promise.resolve(undefined)
        : Promise.resolve({
            base: options.baseMise,
            target: options.targetMise,
          }),
    readWorkspaces: () =>
      Promise.resolve(
        new Map([
          ["scripts", "@shepherdjerred/root-scripts"],
          ["packages/delivery", "@shepherdjerred/delivery"],
          ["packages/ops-model", "@shepherdjerred/ops-model"],
          ["packages/scout-for-lol", "@scout-for-lol/monorepo"],
          ["packages/scout-for-lol/packages/backend", "@scout-for-lol/backend"],
        ]),
      ),
  };
}

describe("verify:extended", () => {
  test("runs the extended tier serially under its own bounded concurrency", () => {
    expect(extendedTurboCommand([])).toEqual([
      "bun",
      "x",
      "--no-install",
      "turbo",
      "run",
      "test:extended",
      "--continue",
      `--concurrency=${String(EXTENDED_CONCURRENCY)}`,
    ]);
    expect(EXTENDED_TASK).toBe("test:extended");
    expect(EXTENDED_CONCURRENCY).toBe(1);
    expect(EXTENDED_CONCURRENCY).toBeLessThan(VERIFY_CONCURRENCY);
    expect(EXTENDED_VITEST_MAX_WORKERS).toBe(2);
  });

  test("forwards Turbo arguments such as a three-dot affected filter", () => {
    expect(
      extendedTurboCommand([
        "--filter=...[origin/main...HEAD]",
        "--summarize",
        "--output-logs=errors-only",
      ]),
    ).toEqual(
      expect.arrayContaining([
        "--filter=...[origin/main...HEAD]",
        "--summarize",
        "--output-logs=errors-only",
        `--concurrency=${String(EXTENDED_CONCURRENCY)}`,
      ]),
    );
  });

  test("lets a caller override the concurrency", () => {
    const command = extendedTurboCommand(["--concurrency=2"]);
    expect(command.filter((arg) => arg.startsWith("--concurrency"))).toEqual([
      "--concurrency=2",
    ]);
    expect(
      extendedTurboCommand(["--concurrency", "3"]).filter((arg) =>
        arg.startsWith("--concurrency"),
      ),
    ).toEqual(["--concurrency"]);
  });

  test("caps Vitest workers at EXTENDED_VITEST_MAX_WORKERS unless set", () => {
    expect(extendedEnvironment({ PATH: "/bin" })).toEqual({
      PATH: "/bin",
      CI_VITEST_MAX_WORKERS: String(EXTENDED_VITEST_MAX_WORKERS),
    });
    expect(
      extendedEnvironment({ CI_VITEST_MAX_WORKERS: "4" })[
        "CI_VITEST_MAX_WORKERS"
      ],
    ).toBe("4");
  });

  test("skips extended suites when .mise.toml has only comment edits and no workspace changes", async () => {
    const commentEdited = `${BASE_MISE_TOML}\n# Added explanatory comment only\n`;
    expect(extendedRuntimeMiseToolsChanged(BASE_MISE_TOML, commentEdited)).toBe(
      false,
    );

    const reader = fakeReader({
      changedFiles: [".mise.toml"],
      baseMise: BASE_MISE_TOML,
      targetMise: commentEdited,
    });
    const resolved = await resolveExtendedForwardedArgs(
      ["--filter=...[origin/main...HEAD]", "--summarize"],
      reader,
    );
    expect(resolved).toEqual({
      skip: true,
      reason: expect.stringContaining("Skipping test:extended"),
    });
    expect(await main(["--filter=...[origin/main...HEAD]"], {}, reader)).toBe(
      0,
    );
  });

  test("skips extended suites on non-runtime CLI bumps in .mise.toml", async () => {
    const cliBumped = BASE_MISE_TOML.replace(
      'lychee = "0.24.2"',
      'lychee = "0.25.0"',
    ).replace('argocd = "3.6.2"', 'argocd = "3.7.0"');
    const resolved = await resolveExtendedForwardedArgs(
      ["--filter", "...[origin/main]"],
      fakeReader({
        changedFiles: [".mise.toml", "mise.lock", "renovate.json"],
        baseMise: BASE_MISE_TOML,
        targetMise: cliBumped,
      }),
    );
    expect(resolved.skip).toBe(true);
  });

  test("retains the full git-range filter when an extended runtime tool changes in .mise.toml", async () => {
    const nodeBumped = BASE_MISE_TOML.replace(
      'node = "24.22.3"',
      'node = "24.23.0"',
    );
    expect(extendedRuntimeMiseToolsChanged(BASE_MISE_TOML, nodeBumped)).toBe(
      true,
    );

    const resolved = await resolveExtendedForwardedArgs(
      ["--filter=...[origin/main...HEAD]"],
      fakeReader({
        changedFiles: [".mise.toml"],
        baseMise: BASE_MISE_TOML,
        targetMise: nodeBumped,
      }),
    );
    expect(resolved).toEqual({
      skip: false,
      args: ["--filter=...[origin/main...HEAD]"],
    });
  });

  test("narrows to changed workspaces (and their dependents) on mixed non-runtime .mise.toml + package diffs", async () => {
    const cliBumped = BASE_MISE_TOML.replace(
      'gh = "2.105.0"',
      'gh = "2.106.0"',
    );
    const resolved = await resolveExtendedForwardedArgs(
      ["--filter=...[origin/main...HEAD]", "--summarize"],
      fakeReader({
        changedFiles: [
          ".mise.toml",
          "packages/ops-model/src/index.ts",
          "packages/scout-for-lol/packages/backend/src/server.ts",
        ],
        baseMise: BASE_MISE_TOML,
        targetMise: cliBumped,
      }),
    );
    expect(resolved).toEqual({
      skip: false,
      args: [
        "--filter=...@scout-for-lol/backend",
        "--filter=...@shepherdjerred/ops-model",
        "--summarize",
      ],
    });
  });

  test("retains the full git-range filter when bun.lock or global tsconfig changes alongside .mise.toml", async () => {
    const commentEdited = `${BASE_MISE_TOML}\n# comment\n`;
    const resolved = await resolveExtendedForwardedArgs(
      ["--filter=...[origin/main...HEAD]"],
      fakeReader({
        changedFiles: [".mise.toml", "bun.lock"],
        baseMise: BASE_MISE_TOML,
        targetMise: commentEdited,
      }),
    );
    expect(resolved).toEqual({
      skip: false,
      args: ["--filter=...[origin/main...HEAD]"],
    });
  });
});
