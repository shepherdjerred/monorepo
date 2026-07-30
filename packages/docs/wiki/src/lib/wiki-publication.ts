const PUBLIC_WORKING_DOCUMENT_PATHS: ReadonlySet<string> = new Set([
  "plans/2026-07-28_human-wiki-scaffold.md",
]);

export function assertPublicWorkingDocumentPathsExist(
  publicPaths: Iterable<string>,
  discoveredPaths: ReadonlySet<string>,
): void {
  const stalePaths = [...publicPaths]
    .filter((sourcePath) => !discoveredPaths.has(sourcePath))
    .sort();
  if (stalePaths.length === 0) {
    return;
  }

  throw new Error(
    [
      "Public working document allowlist contains paths that were not discovered:",
      ...stalePaths.map((sourcePath) => `- ${sourcePath}`),
    ].join("\n"),
  );
}

export function isPublicWorkingDocumentPath(sourcePath: string): boolean {
  return PUBLIC_WORKING_DOCUMENT_PATHS.has(sourcePath);
}

export function isPublicWorkingDirectoryPath(sourcePath: string): boolean {
  const normalizedPath = sourcePath.replaceAll(/^\/|\/$/gu, "");
  const prefix = normalizedPath.length === 0 ? "" : `${normalizedPath}/`;
  for (const documentPath of PUBLIC_WORKING_DOCUMENT_PATHS) {
    if (documentPath.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export function publicWorkingDocumentPaths(paths: Iterable<string>): string[] {
  const discoveredPaths = new Set(paths);
  assertPublicWorkingDocumentPathsExist(
    PUBLIC_WORKING_DOCUMENT_PATHS,
    discoveredPaths,
  );
  return [...discoveredPaths]
    .filter((sourcePath) => isPublicWorkingDocumentPath(sourcePath))
    .sort();
}
