import { Glob } from "bun";
import { z } from "zod";
import { isNoopScript } from "./migration-core.ts";

const PackageJsonSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
  })
  .loose();

const WorkspacePatternSchema = z
  .string()
  .min(1)
  .refine(
    (pattern) => {
      const pathPattern = pattern.startsWith("!") ? pattern.slice(1) : pattern;
      return (
        pathPattern.length > 0 &&
        pathPattern === pathPattern.trim() &&
        pathPattern !== "." &&
        !pathPattern.startsWith("/") &&
        !pathPattern.endsWith("/") &&
        !pathPattern.endsWith("/package.json") &&
        !pathPattern.includes("\\") &&
        !pathPattern.split("/").includes("..")
      );
    },
    {
      message:
        "workspace patterns must be relative package directories without parent traversal",
    },
  );

const WorkspacePatternsSchema = z
  .array(WorkspacePatternSchema)
  .min(1)
  .superRefine((patterns, context) => {
    const seen = new Set<string>();
    for (const [index, pattern] of patterns.entries()) {
      if (seen.has(pattern)) {
        context.addIssue({
          code: "custom",
          message: `duplicate workspace pattern: ${pattern}`,
          path: [index],
        });
      }
      seen.add(pattern);
    }
  });

const RootPackageJsonSchema = z
  .object({
    workspaces: z.union([
      WorkspacePatternsSchema,
      z.object({ packages: WorkspacePatternsSchema }),
    ]),
  })
  .loose();

const requiredScripts = ["build", "test", "lint", "typecheck"] as const;
const nativeTypeScriptPathAssignment =
  "PATH=node_modules/@typescript/native/bin:$PATH";
const nativeTypeScriptCommand = `${nativeTypeScriptPathAssignment} tsc`;
const nativeTypeScriptVersion = "npm:typescript@7.0.2";
const bunGlobalFlagsBeforeX = new Set([
  "-b",
  "-i",
  "--bun",
  "--cpu-prof",
  "--cpu-prof-md",
  "--experimental-http2-fetch",
  "--experimental-http3-fetch",
  "--expose-gc",
  "--heap-prof",
  "--heap-prof-md",
  "--hot",
  "--no-addons",
  "--no-clear-screen",
  "--no-deprecation",
  "--no-env-file",
  "--no-install",
  "--no-orphans",
  "--prefer-latest",
  "--prefer-offline",
  "--redis-preconnect",
  "--silent",
  "--smol",
  "--sql-preconnect",
  "--throw-deprecation",
  "--use-bundled-ca",
  "--use-openssl-ca",
  "--use-system-ca",
  "--watch",
]);
const bunGlobalValueOptionsBeforeX = new Set([
  "-c",
  "-r",
  "--conditions",
  "--config",
  "--console-depth",
  "--cpu-prof-dir",
  "--cpu-prof-interval",
  "--cpu-prof-name",
  "--cron-period",
  "--cron-title",
  "--cwd",
  "--dns-result-order",
  "--elide-lines",
  "--env-file",
  "--fetch-preconnect",
  "--heap-prof-dir",
  "--heap-prof-name",
  "--import",
  "--install",
  "--inspect",
  "--inspect-brk",
  "--inspect-wait",
  "--max-http-header-size",
  "--port",
  "--preload",
  "--require",
  "--shell",
  "--unhandled-rejections",
  "--user-agent",
]);
const bunxFlags = new Set(["--bun", "--no-install", "--silent", "--verbose"]);

function tokenizeShellCommands(script: string): string[][] {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  function finishToken(): void {
    if (token.length === 0) return;
    tokens.push(token);
    token = "";
  }

  function finishCommand(): void {
    finishToken();
    if (tokens.length === 0) return;
    commands.push(tokens);
    tokens = [];
  }

  for (let index = 0; index < script.length; index += 1) {
    const character = script[index];
    if (character === undefined) continue;
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      finishToken();
      if (character === "\n") finishCommand();
      continue;
    }
    if (character === ";" || character === "|" || character === "&") {
      finishCommand();
      if (script[index + 1] === character) index += 1;
      continue;
    }
    token += character;
  }

  if (escaped) token += "\\";
  finishCommand();
  return commands;
}

function isBunGlobalOptionBeforeX(token: string): boolean {
  if (bunGlobalFlagsBeforeX.has(token)) return true;
  const equalsIndex = token.indexOf("=");
  return (
    equalsIndex > 0 &&
    bunGlobalValueOptionsBeforeX.has(token.slice(0, equalsIndex)) &&
    token.slice(equalsIndex + 1).length > 0
  );
}

function isShellEnvironmentAssignment(token: string): boolean {
  const equalsIndex = token.indexOf("=");
  return equalsIndex > 0 && /^[a-z_]\w*$/i.test(token.slice(0, equalsIndex));
}

function findShellExecutableIndex(tokens: string[]): number {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || !isShellEnvironmentAssignment(token)) break;
    index += 1;
  }
  return index;
}

function usesNativeTypeScriptPath(
  tokens: string[],
  executableIndex: number,
): boolean {
  let pathAssignment: string | undefined;
  for (let index = 0; index < executableIndex; index += 1) {
    const token = tokens[index];
    if (token?.startsWith("PATH=") === true) pathAssignment = token;
  }
  return pathAssignment === nativeTypeScriptPathAssignment;
}

function findBunxExecutable(
  tokens: string[],
  startIndex: number,
): string | undefined {
  let index = startIndex;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) return undefined;
    if (bunxFlags.has(token)) {
      index += 1;
      continue;
    }
    if (token === "-p" || token === "--package") {
      index += 2;
      continue;
    }
    if (token.startsWith("--package=") && token.length > "--package=".length) {
      index += 1;
      continue;
    }
    return token;
  }
  return undefined;
}

export function invokesAmbiguousTypeScriptCompiler(script: string): boolean {
  return tokenizeShellCommands(script).some((tokens) => {
    const executableIndex = findShellExecutableIndex(tokens);
    const executable = tokens[executableIndex];
    if (executable === "tsc") {
      return !usesNativeTypeScriptPath(tokens, executableIndex);
    }
    if (executable === "bunx") {
      return findBunxExecutable(tokens, executableIndex + 1) === "tsc";
    }
    if (executable !== "bun") return false;

    let index = executableIndex + 1;
    while (index < tokens.length) {
      const token = tokens[index];
      if (
        token === undefined ||
        token === "x" ||
        !isBunGlobalOptionBeforeX(token)
      ) {
        break;
      }
      index += 1;
    }
    if (tokens[index] !== "x") return false;
    return findBunxExecutable(tokens, index + 1) === "tsc";
  });
}

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
    invokesAmbiguousTypeScriptCompiler(command),
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
    if (invokesAmbiguousTypeScriptCompiler(command)) {
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
packages/scout-for-lol/packages/desktop/src-tauri:build
packages/scout-for-lol/packages/desktop/src-tauri:test
packages/scout-for-lol/packages/desktop/src-tauri:typecheck
packages/scout-for-lol/packages/frontend:test
packages/scout-for-lol/packages/report:build
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

function getWorkspacePatterns(
  rootPackageJson: z.infer<typeof RootPackageJsonSchema>,
): string[] {
  return Array.isArray(rootPackageJson.workspaces)
    ? rootPackageJson.workspaces
    : rootPackageJson.workspaces.packages;
}

function scanWorkspacePattern(root: string, pattern: string): string[] {
  const packagePaths = [
    ...new Glob(`${pattern}/package.json`).scanSync({
      cwd: root,
      onlyFiles: true,
    }),
  ].sort((left, right) => left.localeCompare(right));
  if (packagePaths.length === 0) {
    throw new Error(`workspace pattern matched no packages: ${pattern}`);
  }
  return packagePaths.map((packagePath) =>
    packagePath.slice(0, -"/package.json".length),
  );
}

function resolveWorkspaceDirectories(
  root: string,
  workspacePatterns: string[],
): string[] {
  const includedByPattern = new Map<string, string>();
  for (const pattern of workspacePatterns.filter(
    (candidate) => !candidate.startsWith("!"),
  )) {
    for (const directory of scanWorkspacePattern(root, pattern)) {
      const previousPattern = includedByPattern.get(directory);
      if (previousPattern !== undefined) {
        throw new Error(
          `workspace ${directory} is matched by both ${previousPattern} and ${pattern}`,
        );
      }
      includedByPattern.set(directory, pattern);
    }
  }

  for (const pattern of workspacePatterns.filter((candidate) =>
    candidate.startsWith("!"),
  )) {
    for (const directory of scanWorkspacePattern(root, pattern.slice(1))) {
      includedByPattern.delete(directory);
    }
  }

  return [...includedByPattern.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
}

export async function findComplianceErrors(root: string): Promise<string[]> {
  const rootPackageJson = RootPackageJsonSchema.parse(
    await Bun.file(`${root}/package.json`).json(),
  );
  const workspacePatterns = getWorkspacePatterns(rootPackageJson);
  const errors: string[] = [];
  if (workspacePatterns.some((pattern) => pattern.startsWith("!"))) {
    errors.push("package.json contains excluded workspaces (!packages/...)");
  }

  const packages = new Map<string, z.infer<typeof PackageJsonSchema>>();
  for (const directory of resolveWorkspaceDirectories(
    root,
    workspacePatterns,
  )) {
    packages.set(
      directory,
      PackageJsonSchema.parse(
        await Bun.file(`${root}/${directory}/package.json`).json(),
      ),
    );
  }

  for (const [directory, packageJson] of packages) {
    errors.push(...collectTypeScriptToolchainErrors(directory, packageJson));
    if (directory === "scripts") continue;
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
