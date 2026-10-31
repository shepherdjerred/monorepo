import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
/** A nested workspace with its own task hashes. */
const nestedWorkspace = "src/cdk8s/";

/**
 * homelab's transit build task hashes only scripts/** and top-level src
 * modules (turbo.json). Its dependents inherit that hash through ^build, so a
 * module they load from anywhere else would leave their cache keys stale.
 */
function insideBuildInputs(relativePath: string): boolean {
  return (
    relativePath.startsWith("scripts/") ||
    (relativePath.startsWith("src/") &&
      !relativePath.slice("src/".length).includes("/"))
  );
}

const IMPORT =
  /(?:import|export)[^'"]*?from\s*['"](?<from>[^'"]+)['"]|import\(\s*['"](?<dynamic>[^'"]+)['"]\s*\)/gu;
// `@shepherdjerred/homelab/cdk8s` aliases the nested cdk8s workspace.
const SELF = /^(?:@shepherdjerred\/)?homelab\/(?!cdk8s\/)/u;

function specifiers(text: string): string[] {
  return [...text.matchAll(IMPORT)].flatMap((match) => {
    const specifier = match.groups?.["from"] ?? match.groups?.["dynamic"];
    return specifier === undefined ? [] : [specifier];
  });
}

async function resolve(base: string): Promise<string> {
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(`unresolvable module ${base}`);
}

async function dependentDirectories(): Promise<string[]> {
  const RootSchema = z.object({ workspaces: z.array(z.string()) });
  const PackageSchema = z.object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  });
  const root = RootSchema.parse(
    await Bun.file(path.join(repositoryRoot, "package.json")).json(),
  );
  const dependents: string[] = [];
  for (const directory of root.workspaces) {
    const manifest = PackageSchema.parse(
      await Bun.file(
        path.join(repositoryRoot, directory, "package.json"),
      ).json(),
    );
    if (
      manifest.dependencies?.["homelab"] !== undefined ||
      manifest.devDependencies?.["homelab"] !== undefined
    ) {
      dependents.push(path.join(repositoryRoot, directory));
    }
  }
  return dependents;
}

/** The homelab modules a dependent workspace imports directly. */
async function importedModules(directory: string): Promise<string[]> {
  const modules: string[] = [];
  for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({
    cwd: directory,
  })) {
    if (/(?:^|\/)(?:node_modules|dist)\//u.test(file)) continue;
    const text = await Bun.file(path.join(directory, file)).text();
    for (const specifier of specifiers(text)) {
      if (SELF.test(specifier)) {
        modules.push(
          await resolve(path.join(packageRoot, specifier.replace(SELF, ""))),
        );
      }
    }
  }
  return modules;
}

/** The homelab modules one module imports, resolved to files. */
async function moduleImports(module: string): Promise<string[]> {
  if (!/\.tsx?$/u.test(module)) return [];
  const imports: string[] = [];
  for (const specifier of specifiers(await Bun.file(module).text())) {
    if (specifier.startsWith(".")) {
      imports.push(
        await resolve(path.resolve(path.dirname(module), specifier)),
      );
    } else if (SELF.test(specifier)) {
      imports.push(
        await resolve(path.join(packageRoot, specifier.replace(SELF, ""))),
      );
    }
  }
  return imports;
}

describe("homelab build inputs", () => {
  it("cover every homelab module its dependents load", async () => {
    const dependents = await dependentDirectories();
    expect(dependents.length).toBeGreaterThan(0);
    const imported = await Promise.all(
      dependents.map((directory) => importedModules(directory)),
    );
    const pending = imported.flat();
    expect(pending.length).toBeGreaterThan(0);

    const visited = new Set<string>();
    const outside = new Set<string>();
    for (
      let module = pending.pop();
      module !== undefined;
      module = pending.pop()
    ) {
      if (visited.has(module)) continue;
      visited.add(module);
      const relative = path.relative(packageRoot, module);
      // Other workspaces, including the nested cdk8s one, hash themselves.
      if (relative.startsWith("..") || relative.startsWith(nestedWorkspace)) {
        continue;
      }
      if (!insideBuildInputs(relative)) outside.add(relative);
      pending.push(...(await moduleImports(module)));
    }
    expect([...outside]).toEqual([]);
  });
});
