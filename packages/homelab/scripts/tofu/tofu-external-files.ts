/**
 * Which repository files an OpenTofu stack reads beyond its own directory.
 *
 * A stack archive contains the stack directory plus the external files its
 * manifest entry declares. Anything a configuration reads through `file()`
 * and friends that is neither inside the stack nor declared would be missing
 * from the archive, so every escaping reference must be declared, every
 * declaration must be referenced, and every declared file must exist.
 */
import { lstat } from "node:fs/promises";
import path from "node:path";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";
import { STACK_MANIFEST } from "./tofu-stack-manifest.ts";
import type { StackDefinition } from "./tofu-stack-manifest.ts";

export const TOFU_STACK_ROOT = "packages/homelab/src/tofu";

/** OpenTofu functions whose first argument names a file relative to the root module. */
const FILE_FUNCTIONS = [
  "file",
  "filebase64",
  "filebase64sha256",
  "filebase64sha512",
  "fileexists",
  "filemd5",
  "filesha1",
  "filesha256",
  "filesha512",
  "fileset",
  "templatefile",
] as const;
const FILE_CALL = new RegExp(
  String.raw`\b(?:${FILE_FUNCTIONS.join("|")})\(\s*(?<literal>"[^"]*")?`,
  "gu",
);
const PATH_EXPRESSION =
  /\$\{path\.(?<base>module|root|cwd)\}(?<rest>[^"\s$]*)/gu;
/**
 * Configuration files tofu loads: every `.tf.json` outside the data directory
 * and the test tree. {@link assertSynthesizedStack} keeps HCL out of a stack.
 */
const CONFIGURATION_FILES = "**/*.tf.json";
const HCL_FILES = "**/*.tf";
const SKIPPED_DIRECTORIES = new Set([".terraform", "tests"]);

/**
 * A stack is the committed cdktn synthesis (`main.tf.json`, from
 * `packages/homelab-cdktn`) and holds no HCL, at its root or in a local
 * module: OpenTofu would load a root `.tf` file next to the synthesis and
 * declare things twice, and nothing in the repository lints or reads HCL.
 * `stack` names the directory in the error.
 */
export async function assertSynthesizedStack(
  stack: string,
  stackDirectory: string,
): Promise<void> {
  if (!(await Bun.file(path.join(stackDirectory, "main.tf.json")).exists()))
    throw new Error(
      `Stack ${stack} has no synthesized main.tf.json; packages/homelab-cdktn synthesizes every stack`,
    );
  // Dot entries are skipped: OpenTofu ignores them, and `.terraform/` holds
  // the modules and providers it downloaded, which are not the stack's.
  const hcl = await Array.fromAsync(
    new Bun.Glob(HCL_FILES).scan({
      cwd: stackDirectory,
      onlyFiles: true,
      followSymlinks: false,
    }),
  );
  if (hcl.length > 0)
    throw new Error(
      `Stack ${stack} holds HCL next to its synthesized main.tf.json: ${hcl.toSorted().join(", ")}`,
    );
}

export type StackFileReference = {
  /** Repository-relative configuration file holding the reference. */
  source: string;
  /** The path expression as written. */
  expression: string;
  /** Repository-relative resolved target. */
  target: string;
};

function within(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}${path.sep}`);
}

/** Every string of a JSON configuration, one per line: its expressions, unescaped. */
function jsonExpressions(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.flatMap((item: unknown) => jsonExpressions(item));
  return typeof value === "object" && value !== null
    ? Object.values(value).flatMap((item: unknown) => jsonExpressions(item))
    : [];
}

/**
 * The text file references are searched in. JSON syntax escapes the quotes of
 * `file("...")` inside its string values, so those are decoded first.
 */
function searchableConfiguration(content: string): string {
  return jsonExpressions(JSON.parse(content)).join("\n");
}

function resolveReference(
  repoRoot: string,
  source: string,
  expression: string,
  resolved: string,
): StackFileReference {
  const target = path.relative(repoRoot, path.resolve(resolved));
  if (target.startsWith("..") || path.isAbsolute(target))
    throw new Error(
      `${source} reads ${expression}, which resolves outside the repository`,
    );
  return { source, expression, target };
}

/** Every literal file reference a configuration file makes; a non-literal one cannot be archived and fails. */
export function fileReferences(input: {
  repoRoot: string;
  stackDirectory: string;
  file: string;
  content: string;
}): StackFileReference[] {
  const source = path.relative(input.repoRoot, input.file);
  const moduleDirectory = path.dirname(input.file);
  const content = searchableConfiguration(input.content);
  const references: StackFileReference[] = [];
  for (const match of content.matchAll(PATH_EXPRESSION)) {
    const base = match.groups?.["base"];
    const rest = match.groups?.["rest"] ?? "";
    const expression = match[0];
    if (base === "cwd")
      throw new Error(
        `${source} reads ${expression}; path.cwd depends on the caller and cannot be archived`,
      );
    if (content[match.index + expression.length] === "$")
      throw new Error(
        `${source} reads ${expression}$..., which is not a literal path and cannot be archived`,
      );
    const root = base === "module" ? moduleDirectory : input.stackDirectory;
    references.push(
      resolveReference(
        input.repoRoot,
        source,
        expression,
        path.join(root, rest),
      ),
    );
  }
  for (const match of content.matchAll(FILE_CALL)) {
    const literal = match.groups?.["literal"];
    if (literal === undefined)
      throw new Error(
        `${source} calls ${match[0].trim()} without a literal path, which cannot be archived`,
      );
    const value = literal.slice(1, -1);
    if (value.startsWith("${path.")) continue;
    if (value.includes("${"))
      throw new Error(
        `${source} reads ${literal}, which is not a literal path and cannot be archived`,
      );
    references.push(
      resolveReference(
        input.repoRoot,
        source,
        literal,
        path.join(input.stackDirectory, value),
      ),
    );
  }
  return references;
}

/** All file references of one stack, resolved against the repository. */
export async function stackFileReferences(input: {
  repoRoot: string;
  stackDirectory: string;
}): Promise<StackFileReference[]> {
  const references: StackFileReference[] = [];
  const files = await Array.fromAsync(
    new Bun.Glob(CONFIGURATION_FILES).scan({
      cwd: input.stackDirectory,
      onlyFiles: true,
      dot: true,
      followSymlinks: false,
    }),
  );
  for (const relative of files.sort()) {
    if (relative.split("/").some((part) => SKIPPED_DIRECTORIES.has(part)))
      continue;
    const file = path.join(input.stackDirectory, relative);
    references.push(
      ...fileReferences({
        repoRoot: input.repoRoot,
        stackDirectory: input.stackDirectory,
        file,
        content: await Bun.file(file).text(),
      }),
    );
  }
  return references;
}

/**
 * The stack must be a synthesis holding no HCL, its external references must
 * equal the declaration, and every declared file must be a regular file.
 */
export async function verifyStackExternalFiles(input: {
  repoRoot: string;
  stackDirectory: string;
  declared: readonly string[];
}): Promise<StackFileReference[]> {
  const stack = path.relative(input.repoRoot, input.stackDirectory);
  await assertSynthesizedStack(stack, input.stackDirectory);
  const references = await stackFileReferences(input);
  const external = new Map<string, StackFileReference>();
  for (const reference of references)
    if (!within(reference.target, stack))
      external.set(reference.target, reference);
  const declared = new Set(input.declared);
  const undeclared = [...external.values()].filter(
    (reference) => !declared.has(reference.target),
  );
  if (undeclared.length > 0)
    throw new Error(
      `${stack} reads undeclared external files:\n${undeclared
        .map(
          (reference) =>
            `  ${reference.source}: ${reference.expression} -> ${reference.target}`,
        )
        .join("\n")}`,
    );
  const unreferenced = input.declared.filter((file) => !external.has(file));
  if (unreferenced.length > 0)
    throw new Error(
      `${stack} declares external files it does not read: ${unreferenced.join(", ")}`,
    );
  for (const file of input.declared) {
    const stats = await lstat(path.join(input.repoRoot, file)).catch(
      () => null,
    );
    if (stats?.isFile() !== true)
      throw new Error(
        `${stack} declares external file ${file}, which is not a regular file`,
      );
  }
  return references;
}

/** Every stack in the manifest, against the live repository tree. */
export async function verifyTofuExternalFiles(
  repoRoot: string,
  manifest: Readonly<Record<TofuStack, StackDefinition>> = STACK_MANIFEST,
): Promise<void> {
  for (const stack of TofuStackSchema.options)
    await verifyStackExternalFiles({
      repoRoot,
      stackDirectory: path.join(repoRoot, TOFU_STACK_ROOT, stack),
      declared: manifest[stack].externalFiles,
    });
}
