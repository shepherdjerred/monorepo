import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { TOFU_VALIDATION_INSTALL_FILTERS } from "#src/pipeline/lanes/tofu.ts";
import { TEST_IMAGES as IMAGES } from "#test-identity";

const REPO = path.resolve(import.meta.dir, "../../../..");
/** Every script the validation step runs with `bun --no-install`. */
const ENTRY_POINTS = [
  "packages/homelab/scripts/tofu/tofu-stack.ts",
  "packages/homelab-cdktn/scripts/generate-bindings.ts",
  "packages/homelab-cdktn/scripts/synth.ts",
];

const ManifestSchema = z.looseObject({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
});
type Manifest = z.infer<typeof ManifestSchema>;

const transpiler = new Bun.Transpiler({ loader: "ts" });

async function manifestOf(directory: string): Promise<Manifest> {
  return ManifestSchema.parse(
    await Bun.file(path.join(directory, "package.json")).json(),
  );
}

/** The workspace directory that owns a repository file. */
async function owningWorkspace(file: string): Promise<string> {
  let directory = path.dirname(file);
  while (directory !== REPO && directory.startsWith(REPO)) {
    if (await Bun.file(path.join(directory, "package.json")).exists())
      return directory;
    directory = path.dirname(directory);
  }
  throw new Error(`${file} belongs to no workspace`);
}

/**
 * Not followed: Bun and Node built-ins, and the provider bindings generated
 * into @homelab/cdktn (never committed). The file importing a binding already
 * counts that workspace, and the bindings import only its own dependencies,
 * cdktn and constructs.
 */
function isLeaf(specifier: string): boolean {
  return (
    specifier.startsWith("bun") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("#generated/")
  );
}

/** Repository files one source file imports at runtime. */
async function runtimeImports(file: string): Promise<string[]> {
  if (!/\.[cm]?tsx?$/u.test(file)) return [];
  // The transpiler rejects a leading shebang line.
  const text = await Bun.file(file).text();
  const imports = transpiler.scanImports(text.replace(/^#!.*\n/u, ""));
  return imports
    .filter(({ path: specifier }) => !isLeaf(specifier))
    .map(({ path: specifier }) =>
      // Bun resolves symlinks, so a workspace dependency linked into
      // node_modules comes back as its file in the repository.
      Bun.resolveSync(specifier, path.dirname(file)),
    )
    .filter(
      (resolved) =>
        resolved.startsWith(REPO) && !resolved.includes("/node_modules/"),
    );
}

/**
 * Workspaces whose files the entry points load at runtime. Type-only imports
 * are erased by the transpiler and need nothing installed; third-party
 * modules are leaves, since installing their owner installs them.
 */
async function runtimeWorkspaces(): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  const seen = new Set<string>();
  const pending = ENTRY_POINTS.map((entry) => path.join(REPO, entry));
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const owner = await owningWorkspace(file);
    const { name } = await manifestOf(owner);
    owners.set(name, owner);
    pending.push(...(await runtimeImports(file)));
  }
  return owners;
}

/** What a filtered production install gives a node_modules: the filters and their production workspace dependencies. */
async function installedWorkspaces(
  filters: readonly string[],
): Promise<Set<string>> {
  const { workspaces } = z
    .object({ workspaces: z.array(z.string()) })
    .parse(await Bun.file(path.join(REPO, "package.json")).json());
  const directories = new Map<string, string>();
  for (const workspace of workspaces) {
    const directory = path.join(REPO, workspace);
    const { name } = await manifestOf(directory);
    directories.set(name, directory);
  }
  const installed = new Set<string>();
  const pending = [...filters];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || installed.has(name)) continue;
    const directory = directories.get(name);
    if (directory === undefined) throw new Error(`no workspace named ${name}`);
    installed.add(name);
    const { dependencies = {} } = await manifestOf(directory);
    for (const [dependency, version] of Object.entries(dependencies))
      if (version.startsWith("workspace:")) pending.push(dependency);
  }
  return installed;
}

describe("OpenTofu validation install", () => {
  test("installs every workspace whose files the validated scripts load", async () => {
    const needed = await runtimeWorkspaces();
    // The import walk itself must see the edge that broke cold runners.
    expect([...needed.keys()]).toContain("@homelab/cdk8s");
    const installed = await installedWorkspaces(
      TOFU_VALIDATION_INSTALL_FILTERS,
    );
    const missing = [...needed.keys()].filter(
      (name) => name !== "@shepherdjerred/monorepo" && !installed.has(name),
    );
    expect(missing).toEqual([]);
  });

  test("the step installs exactly the declared filters, production only", () => {
    const steps = buildPipelineSteps({ images: IMAGES, changedBase: "x" });
    const install = steps
      .find((step) => step.key === "tofu-validate")
      ?.commands.find((command) => command.includes("bun-install.sh"));
    expect(install).toBe(
      `ci/scripts/bun-install.sh --frozen-lockfile ${TOFU_VALIDATION_INSTALL_FILTERS.map((name) => `--filter '${name}'`).join(" ")} --production`,
    );
  });
});
