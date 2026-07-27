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
    await Bun.write(`${root}/package.json`, '{"workspaces":["packages/*"]}');
    await Bun.write(
      `${root}/packages/example/package.json`,
      JSON.stringify({
        scripts: {
          build: "bun build.ts",
          test: "bun test",
          lint: "eslint .",
          typecheck: "tsc --noEmit",
        },
      }),
    );
    await Bun.write(`${root}/packages/example/generated/package.json`, "{}");

    expect(await findComplianceErrors(root)).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
