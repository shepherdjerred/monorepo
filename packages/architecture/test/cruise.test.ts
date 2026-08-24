import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertArchitectureFixtures,
  checkArchitecture,
  cruiseArchitectureFixtures,
} from "#src/cruise.ts";

/**
 * Every case here builds a throwaway package in a temp directory. Nothing in
 * this suite reads or writes the repository it runs from.
 */
let packageRoot = "";

async function write(relativePath: string, contents: string): Promise<void> {
  const absolute = path.join(packageRoot, relativePath);
  await mkdir(path.join(absolute, ".."), { recursive: true });
  await writeFile(absolute, contents, "utf8");
}

const domainIsPure = {
  name: "domain-is-pure",
  comment: "the domain must be usable without a transport",
  from: "domain",
  to: ["server"],
};

beforeEach(async () => {
  // realpath matters: on macOS the temp directory is reached through a
  // symlink, and dependency-cruiser reports realpaths — a symlinked baseDir
  // makes every module path absolute and silently unmatched by any rule.
  packageRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "architecture-test-")),
  );
  await write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        target: "esnext",
        allowImportingTsExtensions: true,
        noEmit: true,
      },
    }),
  );
  await write("src/domain/rules.ts", "export const rule = 1;\n");
  await write("src/server/http.ts", "export const serve = 1;\n");
});

afterEach(async () => {
  await rm(packageRoot, { recursive: true, force: true });
});

describe("checkArchitecture", () => {
  it("refuses to pass when the cruise inspected nothing", async () => {
    await rm(path.join(packageRoot, "src"), { recursive: true });
    await mkdir(path.join(packageRoot, "src"));
    await expect(
      checkArchitecture({ packageRoot, definition: {} }),
    ).rejects.toThrow(/pass vacuously/u);
  });

  it("fails a runtime import cycle and names both ends of it", async () => {
    await write(
      "src/domain/rules.ts",
      'import { serve } from "../server/http.ts";\n\nexport const rule = serve;\n',
    );
    await write(
      "src/server/http.ts",
      'import { rule } from "../domain/rules.ts";\n\nexport const serve = () => rule;\n',
    );

    const result = await checkArchitecture({ packageRoot, definition: {} });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.report).toContain("no-circular");
    expect(result.report).toContain("src/domain/rules.ts");
    expect(result.report).toContain("src/server/http.ts");
  });

  it("passes a cycle whose closing edge is deferred behind an await import", async () => {
    await write(
      "src/domain/rules.ts",
      'export async function rule() {\n  const { serve } = await import("../server/http.ts");\n  return serve();\n}\n',
    );
    await write(
      "src/server/http.ts",
      'import { rule } from "../domain/rules.ts";\n\nexport const serve = () => rule;\n',
    );

    const result = await checkArchitecture({ packageRoot, definition: {} });

    expect(result.errorCount).toBe(0);
    expect(result.report).toBe("");
  });

  it("still fails a boundary crossed by a deferred import", async () => {
    // Deferring changes *when* the edge resolves, not whether the layer
    // depends on the other. Only `no-circular` cares about eagerness.
    await write(
      "src/domain/rules.ts",
      'export async function rule() {\n  const { serve } = await import("../server/http.ts");\n  return serve;\n}\n',
    );

    const result = await checkArchitecture({
      packageRoot,
      definition: { boundaries: [domainIsPure] },
    });

    expect(result.errorCount).toBe(1);
    expect(result.report).toContain("domain-is-pure");
  });

  it("fails a layer boundary and explains why the boundary exists", async () => {
    await write(
      "src/domain/rules.ts",
      'import { serve } from "../server/http.ts";\n\nexport const rule = serve;\n',
    );

    const result = await checkArchitecture({
      packageRoot,
      definition: { boundaries: [domainIsPure] },
    });

    expect(result.errorCount).toBe(1);
    expect(result.report).toContain("domain-is-pure");
    expect(result.report).toContain(domainIsPure.comment);
  });
});

describe("cruiseArchitectureFixtures", () => {
  beforeEach(async () => {
    await write(
      "architecture-fixtures/domain-imports-server.ts",
      'import "../src/server/http.ts";\n\nexport const illegal = true;\n',
    );
  });

  it("reports the derived fixture rule for a covered boundary", async () => {
    const result = await cruiseArchitectureFixtures({
      packageRoot,
      definition: { boundaries: [domainIsPure] },
    });

    expect(result.fixtureFiles).toEqual(["domain-imports-server.ts"]);
    expect(result.violatedRuleNames).toEqual(["negative-domain-is-pure"]);
    expect(result.errorCount).toBe(1);
  });

  it("asserts the complete fixture contract", async () => {
    await expect(
      assertArchitectureFixtures({
        packageRoot,
        definition: { boundaries: [domainIsPure] },
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a boundary that has no negative fixture", async () => {
    await expect(
      cruiseArchitectureFixtures({
        packageRoot,
        definition: {
          boundaries: [
            domainIsPure,
            {
              name: "client-is-not-server",
              comment: "the browser bundle must not ship server code",
              from: "client",
              to: ["server"],
            },
          ],
        },
      }),
    ).rejects.toThrow(/has no negative fixture/u);
  });

  it("refuses a fixture that proves no boundary", async () => {
    await write(
      "architecture-fixtures/server-imports-domain.ts",
      'import "../src/domain/rules.ts";\n\nexport const stray = true;\n',
    );

    await expect(
      cruiseArchitectureFixtures({
        packageRoot,
        definition: { boundaries: [domainIsPure] },
      }),
    ).rejects.toThrow(/does not match any boundary/u);
  });

  it("refuses to run for a package that declares no boundaries", async () => {
    await expect(
      cruiseArchitectureFixtures({ packageRoot, definition: {} }),
    ).rejects.toThrow(/declares no layer boundaries/u);
  });
});
