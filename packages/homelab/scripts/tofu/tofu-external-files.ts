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

/** HCL functions whose first argument names a file relative to the root module. */
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
/** Configuration files tofu loads: every `.tf` outside the data directory and the test tree. */
const CONFIGURATION_FILES = "**/*.tf";
const SKIPPED_DIRECTORIES = new Set([".terraform", "tests"]);

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

function stripFullLineComments(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/^\s*(?:#|\/\/)/u.test(line))
    .join("\n");
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
  const content = stripFullLineComments(input.content);
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

/** External references must equal the declaration, and every declared file must be a regular file. */
export async function verifyStackExternalFiles(input: {
  repoRoot: string;
  stackDirectory: string;
  declared: readonly string[];
}): Promise<StackFileReference[]> {
  const stack = path.relative(input.repoRoot, input.stackDirectory);
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
