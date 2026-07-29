const PUBLIC_WORKING_DOCUMENT_PATHS: ReadonlySet<string> = new Set([
  "plans/2026-07-28_human-wiki-scaffold.md",
]);

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
  return [...paths]
    .filter((sourcePath) => isPublicWorkingDocumentPath(sourcePath))
    .sort();
}
