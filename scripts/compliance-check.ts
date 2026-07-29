import { Glob } from "bun";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { isNoopScript } from "./migration-core.ts";

const PackageJsonSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
    workspaces: z
      .union([z.array(z.string()), z.object({ packages: z.array(z.string()) })])
      .optional(),
  })
  .loose();

const requiredScripts = ["build", "test", "lint", "typecheck"] as const;
const nativeTypeScriptCommand =
  "PATH=node_modules/@typescript/native/bin:$PATH tsc";
const nativeTypeScriptVersion = "npm:typescript@7.0.2";
const legacyTypeScriptCommandPattern =
  /(?:^|&&|\|\||;)\s*(?:bunx(?:\s+--no-install)?\s+)?tsc(?:\s|$)/;

function collectTypeScriptToolchainErrors(
  directory: string,
  packageJson: z.infer<typeof PackageJsonSchema>,
): string[] {
  const errors: string[] = [];
  const scripts = packageJson.scripts ?? {};
  const usesNativeCompiler = Object.values(scripts).some((command) =>
    command.includes(nativeTypeScriptCommand),
  );
  const usesAmbiguousCompiler = Object.values(scripts).some((command) =>
    legacyTypeScriptCommandPattern.test(command),
  );
  const nativeTypeScriptDependency =
    packageJson.devDependencies?.["@typescript/native"];
  if (
    (usesNativeCompiler || usesAmbiguousCompiler) &&
    nativeTypeScriptDependency !== nativeTypeScriptVersion
  ) {
    errors.push(
      `${directory} must declare @typescript/native as ${nativeTypeScriptVersion}`,
    );
  }
  if (
    nativeTypeScriptDependency !== undefined &&
    !usesNativeCompiler &&
    !usesAmbiguousCompiler
  ) {
    errors.push(
      `${directory} declares @typescript/native without invoking the native compiler`,
    );
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (legacyTypeScriptCommandPattern.test(command)) {
      errors.push(
        `${directory} script ${name} invokes ambiguous tsc instead of ${nativeTypeScriptCommand}`,
      );
    }
  }
  return errors;
}

const exemptions = new Set(
  `
packages/glitter:build
packages/glitter:test
packages/glitter:lint
packages/glitter:typecheck
packages/resume:test
packages/resume:lint
packages/resume:typecheck
packages/leetcode:test
packages/birmel:build
packages/streambot:build
packages/monarch:build
packages/llm-observability:build
packages/discord-stream-lifecycle:build
packages/discord-plays-core:build
packages/trmnl-dashboard:build
packages/tasks-for-obsidian:build
packages/starlight-karma-bot:build
packages/tasknotes-types:build
packages/code-review:build
packages/cooklang-rich-preview:test
packages/stocks-sjer-red:test
packages/discord-video-stream:lint
packages/discord-plays-mario-kart/packages/common:test
packages/discord-plays-pokemon/packages/common:test
packages/discord-plays-pokemon/packages/frontend:test
packages/scout-for-lol/packages/app:test
packages/scout-for-lol/packages/data:build
packages/scout-for-lol/packages/desktop:test
packages/scout-for-lol/packages/frontend:test
packages/scout-for-lol/packages/ui:build
packages/scout-for-lol/packages/ui:test
packages/scout-for-lol:build
packages/scout-for-lol:test
packages/scout-for-lol:lint
packages/scout-for-lol:typecheck
packages/home-assistant:build
packages/sjer.red:test
packages/release-tools:build
packages/release-tools:test
packages/release-tools:lint
packages/release-tools:typecheck
packages/temporal:build
packages/homelab:build
packages/homelab:test
packages/homelab:lint
packages/homelab:typecheck
packages/discord-plays-pokemon/packages/backend:build
packages/discord-plays-mario-kart/packages/backend:build
`
    .trim()
    .split("\n"),
);

export async function findComplianceErrors(root: string): Promise<string[]> {
  const rootPackageText = await Bun.file(`${root}/package.json`).text();
  const errors: string[] = [];
  if (rootPackageText.includes('"!packages/')) {
    errors.push("package.json contains excluded workspaces (!packages/...)");
  }

  const packages = new Map<string, z.infer<typeof PackageJsonSchema>>();
  async function visit(directory: string): Promise<void> {
    if (packages.has(directory)) return;
    const file = Bun.file(`${root}/${directory}/package.json`);
    if (!(await file.exists())) return;
    const packageJson = PackageJsonSchema.parse(await file.json());
    packages.set(directory, packageJson);
    const workspacePatterns = Array.isArray(packageJson.workspaces)
      ? packageJson.workspaces
      : (packageJson.workspaces?.packages ?? []);
    for (const pattern of workspacePatterns) {
      for (const packagePath of new Glob(
        `${directory}/${pattern}/package.json`,
      ).scanSync({ cwd: root, onlyFiles: true })) {
        await visit(packagePath.slice(0, -"/package.json".length));
      }
    }
  }

  for (const entry of await readdir(`${root}/packages`, {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) await visit(`packages/${entry.name}`);
  }

  for (const [directory, packageJson] of [...packages].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    errors.push(...collectTypeScriptToolchainErrors(directory, packageJson));
    for (const script of requiredScripts) {
      const key = `${directory}:${script}`;
      const command = packageJson.scripts?.[script];
      if (command === undefined) {
        if (!exemptions.has(key))
          errors.push(`${directory} missing ${script} script`);
      } else if (isNoopScript(command) && !exemptions.has(key)) {
        errors.push(`${directory} has no-op stub ${script} script: ${command}`);
      }
    }
  }
  const scriptsPackageJson = PackageJsonSchema.parse(
    await Bun.file(`${root}/scripts/package.json`).json(),
  );
  errors.push(
    ...collectTypeScriptToolchainErrors("scripts", scriptsPackageJson),
  );
  return errors;
}

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const errors = await findComplianceErrors(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    throw new Error(
      `Compliance check failed with ${errors.length.toString()} error(s)`,
    );
  }
  console.log("All packages compliant");
}
