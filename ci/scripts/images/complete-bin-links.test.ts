import { lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { completeBinLinks, declaredBins } from "./complete-bin-links.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

type Package = {
  readonly entry: string;
  readonly name: string;
  readonly manifest: Record<string, unknown>;
  readonly dependencies?: readonly Package[];
};

async function storeWith(packages: readonly Package[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bun-store-"));
  roots.push(root);
  const store = path.join(root, "node_modules", ".bun");
  for (const pkg of packages) {
    const dir = path.join(store, pkg.entry, "node_modules", pkg.name);
    await mkdir(dir, { recursive: true });
    await Bun.write(
      path.join(dir, "package.json"),
      JSON.stringify(pkg.manifest),
    );
  }
  for (const pkg of packages) {
    for (const dependency of pkg.dependencies ?? []) {
      const link = path.join(store, pkg.entry, "node_modules", dependency.name);
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(
        path.relative(
          path.dirname(link),
          path.join(store, dependency.entry, "node_modules", dependency.name),
        ),
        link,
      );
    }
  }
  return store;
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

describe("completeBinLinks", () => {
  test("links the bins a lost race skipped between cycle members only", async () => {
    const browserslist: Package = {
      entry: "browserslist@4.28.8+hash",
      name: "browserslist",
      manifest: { name: "browserslist", bin: { browserslist: "./cli.js" } },
    };
    const updater: Package = {
      entry: "update-browserslist-db@1.3.1+hash",
      name: "update-browserslist-db",
      manifest: { name: "update-browserslist-db", bin: "cli.js" },
      dependencies: [browserslist],
    };
    const tool: Package = {
      entry: "@scope+tool@1.0.0",
      name: "@scope/tool",
      manifest: { name: "@scope/tool", bin: { tool: "./bin/tool.js" } },
    };
    const consumer: Package = {
      entry: "consumer@1.0.0",
      name: "consumer",
      manifest: { name: "consumer" },
      dependencies: [tool],
    };
    const store = await storeWith([
      { ...browserslist, dependencies: [updater] },
      updater,
      tool,
      consumer,
    ]);

    expect(await completeBinLinks(store)).toEqual([
      "browserslist@4.28.8+hash/node_modules/.bin/update-browserslist-db",
      "update-browserslist-db@1.3.1+hash/node_modules/.bin/browserslist",
    ]);
    expect(
      await readlink(
        path.join(
          store,
          "browserslist@4.28.8+hash/node_modules/.bin/update-browserslist-db",
        ),
      ),
    ).toBe("../update-browserslist-db/cli.js");
    // Bun always waits for a dependency outside a cycle, so a missing link
    // there is not a race this step papers over.
    expect(
      await exists(path.join(store, "consumer@1.0.0/node_modules/.bin/tool")),
    ).toBe(false);
    expect(await completeBinLinks(store)).toEqual([]);
  });

  test("keeps a bin link the install already wrote", async () => {
    const left: Package = {
      entry: "left@1.0.0",
      name: "left",
      manifest: { name: "left", bin: { shared: "left.js" } },
    };
    const right: Package = {
      entry: "right@1.0.0",
      name: "right",
      manifest: { name: "right", bin: { shared: "right.js" } },
      dependencies: [left],
    };
    const store = await storeWith([{ ...left, dependencies: [right] }, right]);
    const link = path.join(store, "left@1.0.0/node_modules/.bin/shared");
    await mkdir(path.dirname(link), { recursive: true });
    await symlink("../right/right.js", link);

    expect(await completeBinLinks(store)).toEqual([
      "right@1.0.0/node_modules/.bin/shared",
    ]);
    expect(await readlink(link)).toBe("../right/right.js");
  });
});

describe("declaredBins", () => {
  test("names a string bin after the unscoped package", () => {
    expect(declaredBins("@scope/tool", { bin: "./cli.js" })).toEqual(
      new Map([["tool", "./cli.js"]]),
    );
  });

  test("fails loudly for bin layouts it cannot reproduce", () => {
    expect(() => declaredBins("dir", { directories: { bin: "bin" } })).toThrow(
      "dir uses directories.bin inside a cycle",
    );
    expect(() => declaredBins("odd", { bin: ["a"] })).toThrow(
      "odd declares an unsupported bin field",
    );
  });
});
