import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findComplianceErrors } from "./compliance-check.ts";
import { isNoopScript } from "./migration-core.ts";

describe("isNoopScript", () => {
  test.each([
    "true",
    ":",
    "echo",
    "echo not implemented",
    "echo\tnot implemented",
  ])("rejects %s", (command) => {
    expect(isNoopScript(command)).toBe(true);
  });

  test("accepts a real command", () => {
    expect(isNoopScript("bun test")).toBe(false);
  });
});

test("checks declared workspaces without treating generated package files as members", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await mkdir(`${root}/packages/example/generated`, { recursive: true });
    await mkdir(`${root}/scripts`, { recursive: true });
    await Bun.write(`${root}/package.json`, '{"workspaces":["packages/*"]}');
    await Bun.write(
      `${root}/packages/example/package.json`,
      JSON.stringify({
        scripts: {
          build: "bun build.ts",
          test: "bun test",
          lint: "eslint .",
          typecheck:
            "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
        },
        devDependencies: {
          "@typescript/native": "npm:typescript@7.0.2",
          typescript: "^6.0.3",
        },
      }),
    );
    await Bun.write(`${root}/packages/example/generated/package.json`, "{}");
    await Bun.write(`${root}/scripts/package.json`, "{}");

    expect(await findComplianceErrors(root)).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects ambiguous TypeScript compiler commands and missing native aliases", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await mkdir(`${root}/packages/example`, { recursive: true });
    await mkdir(`${root}/scripts`, { recursive: true });
    await Bun.write(`${root}/package.json`, '{"workspaces":["packages/*"]}');
    await Bun.write(
      `${root}/packages/example/package.json`,
      JSON.stringify({
        scripts: {
          build: "bun build.ts",
          test: "bun test",
          lint: "eslint .",
          typecheck: "bunx --no-install tsc --noEmit",
        },
        devDependencies: { typescript: "^6.0.3" },
      }),
    );
    await Bun.write(`${root}/scripts/package.json`, "{}");

    const errors = await findComplianceErrors(root);
    expect(errors).toContain(
      "packages/example script typecheck invokes ambiguous tsc instead of PATH=node_modules/@typescript/native/bin:$PATH tsc",
    );
    expect(errors).toContain(
      "packages/example must declare @typescript/native as npm:typescript@7.0.2",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects native compiler aliases that no script invokes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await mkdir(`${root}/packages/example`, { recursive: true });
    await mkdir(`${root}/scripts`, { recursive: true });
    await Bun.write(`${root}/package.json`, '{"workspaces":["packages/*"]}');
    await Bun.write(
      `${root}/packages/example/package.json`,
      JSON.stringify({
        scripts: {
          build: "bun build.ts",
          test: "bun test",
          lint: "eslint .",
          typecheck: "astro check",
        },
        devDependencies: {
          "@typescript/native": "npm:typescript@7.0.2",
          typescript: "^6.0.3",
        },
      }),
    );
    await Bun.write(`${root}/scripts/package.json`, "{}");

    expect(await findComplianceErrors(root)).toContain(
      "packages/example declares @typescript/native without invoking the native compiler",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
