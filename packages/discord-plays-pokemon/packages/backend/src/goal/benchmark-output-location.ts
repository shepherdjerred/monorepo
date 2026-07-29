import path from "node:path";
import { realpath } from "node:fs/promises";

function pathIsInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function resolveProspectivePath(filePath: string): Promise<string> {
  let existingAncestor = path.resolve(filePath);
  const missingSegments: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(existingAncestor), ...missingSegments);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error(
        `benchmark output has no resolvable ancestor: ${filePath}`,
      );
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
}

export async function requireBenchmarkOutputOutsideImplementation(
  implementationRoot: string,
  outputDirectory: string,
): Promise<void> {
  const [resolvedImplementation, resolvedOutput] = await Promise.all([
    realpath(implementationRoot),
    resolveProspectivePath(outputDirectory),
  ]);
  if (pathIsInside(resolvedImplementation, resolvedOutput)) {
    throw new Error(
      `benchmark output must be outside the target implementation: ${outputDirectory}`,
    );
  }
}
