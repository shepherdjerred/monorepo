// Leaf text-parsing primitives shared by validate-pipeline-lib.ts and
// validate-pipeline-step-structure.ts. Kept dependency-free so both files can
// depend on it without creating an import cycle between them.

export function fail(message: string): never {
  throw new Error(`[validate-pipeline] ${message}`);
}

export function scalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function hasTrimmedLine(
  block: string | undefined,
  expected: string,
): boolean {
  return block?.split("\n").some((line) => line.trim() === expected) ?? false;
}
