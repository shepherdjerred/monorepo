/**
 * A Dockerfile that `bun build`s a workspace package must copy that package
 * and the workspace packages its source imports (one further hop). The image
 * build is the first thing that used to notice a missing COPY, on main.
 *
 * Coverage is "some source path under the package", not a full directory
 * copy: several images intentionally copy only the files they compile.
 */
import { Glob } from "bun";
import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadWorkspaces } from "../../ci/scripts/selectors/select-image-targets-workspaces.ts";

const BOOLEAN_COPY_FLAGS = new Set(["--parents", "--link"]);
const PackageMain = z.object({ main: z.string().optional() });

export type DockerfileStage = {
  readonly name: string;
  readonly parent: string | null;
  readonly copies: readonly string[];
  readonly copiedFrom: readonly string[];
  readonly runs: readonly string[];
};

type WorkspacePackage = {
  readonly name: string;
  readonly dir: string;
};

function joinedLines(dockerfile: string): string[] {
  const lines: string[] = [];
  let pending = "";
  for (const line of dockerfile.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    pending = pending.length === 0 ? trimmed : `${pending} ${trimmed}`;
    if (pending.endsWith("\\")) {
      pending = pending.slice(0, -1).trimEnd();
      continue;
    }
    if (pending.length > 0) lines.push(pending);
    pending = "";
  }
  if (pending.length > 0) lines.push(pending);
  return lines;
}

function shellTokens(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"[^"]*"|'[^']*'|\S+/gu;
  for (const match of input.matchAll(pattern)) {
    const token = match[0];
    tokens.push(
      token.startsWith('"') || token.startsWith("'")
        ? token.slice(1, -1)
        : token,
    );
  }
  return tokens;
}

function copyInstruction(line: string): {
  sources: string[];
  from: string | null;
} {
  const tokens = shellTokens(line);
  let from: string | null = null;
  const paths: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token === "--from") {
      from = tokens[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }
    if (token.startsWith("--")) {
      if (!token.includes("=") && !BOOLEAN_COPY_FLAGS.has(token)) index += 1;
      continue;
    }
    paths.push(token);
  }
  return { sources: paths.slice(0, -1), from };
}

type MutableStage = {
  name: string;
  parent: string | null;
  copies: string[];
  copiedFrom: string[];
  runs: string[];
};

function openStage(
  line: string,
  stages: readonly DockerfileStage[],
): MutableStage {
  const tokens = shellTokens(line);
  const asAt = tokens.findIndex((token) => token === "AS" || token === "as");
  const image = tokens[1] ?? "";
  const name = asAt === -1 ? image : (tokens[asAt + 1] ?? image);
  const parent = stages.some((stage) => stage.name === image) ? image : null;
  return { name, parent, copies: [], copiedFrom: [], runs: [] };
}

function recordInstruction(current: MutableStage, line: string): void {
  if (line.startsWith("COPY ") || line.startsWith("COPY\t")) {
    const copy = copyInstruction(line);
    if (copy.from === null) current.copies.push(...copy.sources);
    else current.copiedFrom.push(copy.from);
    return;
  }
  if (line.startsWith("RUN ")) current.runs.push(line.slice(4));
}

export function parseDockerfile(dockerfile: string): DockerfileStage[] {
  const stages: MutableStage[] = [];
  let current: MutableStage | undefined;
  for (const line of joinedLines(dockerfile)) {
    if (line.startsWith("FROM ")) {
      current = openStage(line, stages);
      stages.push(current);
      continue;
    }
    if (current === undefined) continue;
    recordInstruction(current, line);
  }
  return stages;
}

function stageFiles(
  stages: readonly DockerfileStage[],
  name: string,
  seen = new Set<string>(),
): string[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const stage = stages.find((candidate) => candidate.name === name);
  if (stage === undefined) return [];
  const inherited = [
    ...(stage.parent === null ? [] : stageFiles(stages, stage.parent, seen)),
    ...stage.copiedFrom.flatMap((from) => stageFiles(stages, from, seen)),
  ];
  return [...inherited, ...stage.copies];
}

/** A copied source path counts when it is the package or a file inside it. */
export function copyCoversPackage(
  copied: readonly string[],
  packageDir: string,
): boolean {
  const dir = packageDir.replace(/\/$/u, "");
  return copied.some((entry) => {
    const source = entry.replace(/\/$/u, "");
    return (
      source === dir ||
      dir.startsWith(`${source}/`) ||
      (source.startsWith(`${dir}/`) && source !== `${dir}/package.json`)
    );
  });
}

function commandTail(command: string, marker: string): string | null {
  const at = command.indexOf(marker);
  const previous = at <= 0 ? " " : command.charAt(at - 1);
  const bounded = previous === " " || previous === "\t";
  return at === -1 || !bounded
    ? null
    : command.slice(at + marker.length).trim();
}

export function buildEntrypoints(run: string): string[] {
  let cwd = "";
  const entries: string[] = [];
  for (const part of run.split(/&&|;/u)) {
    const command = part.trim();
    const cd = commandTail(command, "cd ");
    const cdPath = cd === null ? undefined : shellTokens(cd)[0];
    if (cdPath !== undefined) cwd = cdPath;
    const built = commandTail(command, "bun build ");
    if (built === null) continue;
    const entry = shellTokens(built).find((token) => !token.startsWith("-"));
    if (entry === undefined) continue;
    entries.push(normalizeEntry(cwd, entry));
  }
  return entries;
}

function normalizeEntry(cwd: string, entry: string): string {
  if (entry.startsWith("/app/")) return entry.slice("/app/".length);
  if (entry.startsWith("/opt/storm-forum/")) {
    return `packages/storm-forum/${entry.slice("/opt/storm-forum/".length)}`;
  }
  if (entry.startsWith("/")) return entry.slice(1);
  return cwd.length === 0 ? entry : path.posix.join(cwd, entry);
}

function quotedSpecifier(source: string, marker: string): string | null {
  const at = source.indexOf(marker);
  if (at === -1) return null;
  const rest = source.slice(at + marker.length).trimStart();
  const quote = rest.charAt(0);
  if (quote !== '"' && quote !== "'") return null;
  const end = rest.indexOf(quote, 1);
  return end === -1 ? null : rest.slice(1, end);
}

function specifiers(
  source: string,
): { specifier: string; typeOnly: boolean }[] {
  const found: { specifier: string; typeOnly: boolean }[] = [];
  for (const chunk of source.split(";")) {
    const typeOnly =
      chunk.includes("import type") || chunk.includes("export type");
    const from = quotedSpecifier(chunk, "from ");
    if (from !== null) {
      found.push({ specifier: from, typeOnly });
      continue;
    }
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      const dynamic = quotedSpecifier(trimmed, "import(");
      if (dynamic !== null) {
        found.push({ specifier: dynamic, typeOnly: false });
        continue;
      }
      if (!trimmed.startsWith("import ")) continue;
      const side = quotedSpecifier(trimmed, "import ");
      if (side !== null) found.push({ specifier: side, typeOnly: false });
    }
  }
  return found;
}

async function resolveFile(candidate: string): Promise<string | null> {
  const options = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.mts`,
    `${candidate}.js`,
    path.join(candidate, "index.ts"),
  ];
  for (const option of options) {
    const info = await stat(option).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ) {
        return null;
      }
      throw error;
    });
    if (info?.isFile() === true) return option;
  }
  return null;
}

function workspaceFor(
  specifier: string,
  packages: readonly WorkspacePackage[],
): WorkspacePackage | null {
  let match: WorkspacePackage | null = null;
  for (const pkg of packages) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) {
      continue;
    }
    if (match === null || pkg.name.length > match.name.length) match = pkg;
  }
  return match;
}

function packageContaining(
  file: string,
  repoRoot: string,
  packages: readonly WorkspacePackage[],
): WorkspacePackage | null {
  const relative = path.relative(repoRoot, file);
  let match: WorkspacePackage | null = null;
  for (const pkg of packages) {
    const dir = pkg.dir.replace(/\/$/u, "");
    if (relative !== dir && !relative.startsWith(`${dir}/`)) continue;
    if (match === null || dir.length > match.dir.length) match = pkg;
  }
  return match;
}

async function resolveWorkspaceFile(
  pkg: WorkspacePackage,
  specifier: string,
  repoRoot: string,
): Promise<string | null> {
  const root = path.join(repoRoot, pkg.dir);
  if (specifier === pkg.name) {
    const manifest = PackageMain.parse(
      JSON.parse(await Bun.file(path.join(root, "package.json")).text()),
    );
    return resolveFile(path.join(root, manifest.main ?? "src/index.ts"));
  }
  const subpath = specifier.slice(pkg.name.length + 1);
  return (
    (await resolveFile(path.join(root, subpath))) ??
    (await resolveFile(path.join(root, "src", subpath)))
  );
}

type Walk = {
  readonly repoRoot: string;
  readonly packages: readonly WorkspacePackage[];
  readonly required: Set<string>;
  readonly queue: { file: string; allowHop: boolean }[];
};

async function enqueueImport(
  file: string,
  imported: { specifier: string; typeOnly: boolean },
  allowHop: boolean,
  walk: Walk,
): Promise<void> {
  if (imported.typeOnly) return;
  if (imported.specifier.startsWith(".")) {
    const resolved = await resolveFile(
      path.resolve(path.dirname(file), imported.specifier),
    );
    // Relative imports stay in this compilation. A workspace import is the
    // one hop, and that hop does not continue into a third package.
    if (resolved !== null) walk.queue.push({ file: resolved, allowHop });
    return;
  }
  const pkg = workspaceFor(imported.specifier, walk.packages);
  if (pkg === null) return;
  walk.required.add(pkg.dir.replace(/\/$/u, ""));
  if (!allowHop) return;
  const resolved = await resolveWorkspaceFile(
    pkg,
    imported.specifier,
    walk.repoRoot,
  );
  if (resolved !== null) walk.queue.push({ file: resolved, allowHop: false });
}

async function considerFile(
  file: string,
  allowHop: boolean,
  walk: Walk,
): Promise<void> {
  if (
    !file.startsWith(walk.repoRoot) ||
    file.includes(`${path.sep}node_modules${path.sep}`)
  ) {
    return;
  }
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) return;
  const owner = packageContaining(file, walk.repoRoot, walk.packages);
  if (owner !== null) walk.required.add(owner.dir.replace(/\/$/u, ""));
  const source = await Bun.file(file).text();
  for (const imported of specifiers(source)) {
    await enqueueImport(file, imported, allowHop, walk);
  }
}

/** Workspace directories a `bun build` entry needs copied into its stage. */
export async function requiredPackageDirs(
  entry: string,
  repoRoot: string,
): Promise<string[]> {
  const loaded = await loadWorkspaces(repoRoot);
  const packages = [...loaded.entries()].map(([name, pkg]) => ({
    name,
    dir: pkg.dir,
  }));
  const absolute = path.resolve(repoRoot, entry);
  const required = new Set<string>();
  const seen = new Set<string>();
  const walk: Walk = {
    repoRoot,
    packages,
    required,
    queue: [{ file: absolute, allowHop: true }],
  };
  while (walk.queue.length > 0) {
    const item = walk.queue.pop();
    if (item === undefined) continue;
    const key = `${item.allowHop ? "hop" : "stay"}:${item.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 5000) {
      throw new Error(
        `import walk from ${entry} exceeded 5000 files; refusing a general graph`,
      );
    }
    await considerFile(item.file, item.allowHop, walk);
  }
  return [...required].sort();
}

export function missingPackageCopies(
  dockerfile: string,
  stageName: string,
  packageDirs: readonly string[],
): string[] {
  const stages = parseDockerfile(dockerfile);
  const copied = stageFiles(stages, stageName);
  return packageDirs.filter((dir) => !copyCoversPackage(copied, dir));
}

async function checkDockerfile(
  repoRoot: string,
  dockerfilePath: string,
): Promise<string[]> {
  const text = await Bun.file(dockerfilePath).text();
  const stages = parseDockerfile(text);
  const problems: string[] = [];
  for (const stage of stages) {
    for (const run of stage.runs) {
      for (const entry of buildEntrypoints(run)) {
        const absolute = path.join(repoRoot, entry);
        if (!(await Bun.file(absolute).exists())) continue;
        const required = await requiredPackageDirs(entry, repoRoot);
        const missing = missingPackageCopies(text, stage.name, required);
        for (const dir of missing) {
          problems.push(
            `${dockerfilePath}: ${stage.name} bun build ${entry} does not copy ${dir}`,
          );
        }
      }
    }
  }
  return problems;
}

export async function dockerfileCopyProblems(
  repoRoot: string,
): Promise<string[]> {
  const problems: string[] = [];
  const glob = new Glob("**/Dockerfile");
  for await (const file of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
    if (file.includes("node_modules/") || file.startsWith("sandbox/")) continue;
    problems.push(
      ...(await checkDockerfile(repoRoot, path.join(repoRoot, file))),
    );
  }
  return problems;
}

if (import.meta.main) {
  const repoRoot = path.resolve(import.meta.dir, "../..");
  const problems = await dockerfileCopyProblems(repoRoot);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
