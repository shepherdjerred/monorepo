import { test, expect, describe } from "bun:test";
import { PACKAGES, resolvePackage } from "#lib/screenshot/catalog.ts";
import { repoRoot } from "#lib/deployed/git.ts";

describe("screenshot package registry", () => {
  test("aliases are unique", () => {
    const aliases = PACKAGES.map((p) => p.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  test("every cwd exists on disk", async () => {
    const root = await repoRoot();
    if (root === null) {
      throw new Error("not inside the monorepo (git rev-parse failed)");
    }
    for (const entry of PACKAGES) {
      const exists = await Bun.file(
        `${root}/${entry.cwd}/package.json`,
      ).exists();
      expect(exists).toBe(true);
    }
  });

  test("every devCommand's `bun run <script>` exists in that package's package.json", async () => {
    const root = await repoRoot();
    if (root === null) {
      throw new Error("not inside the monorepo (git rev-parse failed)");
    }
    for (const entry of PACKAGES) {
      const [runner, runSubcommand, script] = entry.devCommand;
      expect(runner).toBe("bun");
      expect(runSubcommand).toBe("run");
      if (script === undefined) {
        throw new Error(`${entry.alias}: devCommand is missing a script name`);
      }

      const pkgJsonPath = `${root}/${entry.cwd}/package.json`;
      const pkgJson: unknown = await Bun.file(pkgJsonPath).json();
      const scripts =
        typeof pkgJson === "object" &&
        pkgJson !== null &&
        "scripts" in pkgJson &&
        typeof pkgJson.scripts === "object" &&
        pkgJson.scripts !== null
          ? pkgJson.scripts
          : {};
      expect(Object.keys(scripts)).toContain(script);
    }
  });

  test("resolvePackage throws a helpful error for an unknown alias", () => {
    expect(() => resolvePackage("does-not-exist")).toThrow(/Unknown package/);
  });

  test("resolvePackage returns the matching entry", () => {
    expect(resolvePackage("scout-app").alias).toBe("scout-app");
  });
});
