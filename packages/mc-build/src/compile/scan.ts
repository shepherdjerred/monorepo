/**
 * Purity scan for build programs and everything they import. Programs are
 * pure geometry: the only runtime imports allowed are shared components
 * (`@shepherdjerred/mc-build/components/<name>/…`) and helper files inside
 * the build directory (`./lib/walls.ts`). Every scanned file must avoid the
 * ambient escape hatches below. This is for determinism and to contain
 * accidents, not a security boundary.
 */
import path from "node:path";

/** Specifier prefix build programs use to import shared components. */
export const COMPONENT_PREFIX = "@shepherdjerred/mc-build/components/";

/** Where shared components live (packages/mc-build/components). */
export const COMPONENTS_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "components",
);

/** Identifiers a build program may not touch: it is pure geometry. */
const FORBIDDEN = [
  /\bprocess\b/u,
  /\bBun\b/u,
  /\bfetch\s*\(/u,
  /\brequire\s*\(/u,
  /\bMath\.random\b/u,
  /\bDate\b/u,
  /\beval\s*\(/u,
  /\bnew\s+Function\b/u,
  /\bglobalThis\b/u,
  /\bimport\s*\(/u,
];

export class BuildProgramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildProgramError";
  }
}

function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/\/\/.*$/gmu, "");
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function importHelp(specifier: string, where: string): string {
  return `Build programs may only \`import type\` from other packages; runtime imports are limited to components (${COMPONENT_PREFIX}<name>/index.ts, see \`toolkit mc build component ls\`) and helper .ts files inside the build directory (./lib/helpers.ts). Found "${specifier}"${where}. Everything else is on ctx (ctx.geo, ctx.mat, ctx.craft, ctx.noise, ctx.site).`;
}

/**
 * Checks one source: forbidden identifiers, and runtime imports that are
 * neither components nor relative helpers. Returns the allowed specifiers.
 */
export function scanProgram(source: string, file?: string): string[] {
  const where = file === undefined ? "" : ` in ${file}`;
  const specifiers = new Bun.Transpiler({ loader: "ts" })
    .scanImports(source)
    .map((entry) => entry.path);
  for (const specifier of specifiers) {
    if (!isRelative(specifier) && !specifier.startsWith(COMPONENT_PREFIX)) {
      throw new BuildProgramError(importHelp(specifier, where));
    }
  }
  const code = stripComments(source);
  for (const pattern of FORBIDDEN) {
    const match = pattern.exec(code);
    if (match !== null) {
      throw new BuildProgramError(
        `Build programs must be deterministic and self-contained; \`${match[0].trim()}\` is not allowed${where} (use ctx.rng() or ctx.noise() for randomness).`,
      );
    }
  }
  return specifiers;
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** Where an allowed specifier imported by `from` lives on disk. */
async function resolveImport(
  specifier: string,
  from: string,
  buildRoot: string,
): Promise<string> {
  const inComponents = within(COMPONENTS_DIR, from);
  const target = specifier.startsWith(COMPONENT_PREFIX)
    ? path.join(COMPONENTS_DIR, specifier.slice(COMPONENT_PREFIX.length))
    : path.resolve(path.dirname(from), specifier);
  const root =
    inComponents || specifier.startsWith(COMPONENT_PREFIX)
      ? COMPONENTS_DIR
      : buildRoot;
  if (!within(root, target)) {
    throw new BuildProgramError(
      `"${specifier}" in ${from} resolves outside ${root === COMPONENTS_DIR ? "the components library" : "the build directory"}.`,
    );
  }
  if (!target.endsWith(".ts")) {
    throw new BuildProgramError(
      `"${specifier}" in ${from} must name a .ts file (e.g. ./lib/helpers.ts).`,
    );
  }
  if (!(await Bun.file(target).exists())) {
    throw new BuildProgramError(`"${specifier}" in ${from} does not exist.`);
  }
  return target;
}

/**
 * Scans a program and every component or helper it imports, transitively.
 * Returns the absolute paths scanned (the program first).
 */
export async function scanModuleGraph(program: string): Promise<string[]> {
  const entry = path.resolve(program);
  const buildRoot = path.dirname(entry);
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);
    const specifiers = scanProgram(await Bun.file(file).text(), file);
    for (const specifier of specifiers) {
      queue.push(await resolveImport(specifier, file, buildRoot));
    }
  }
  return [...seen];
}
