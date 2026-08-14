const HUMAN_WIKI_PREFIX = "wiki/";

export function isWorkflowDocumentPath(path: string): boolean {
  return path !== "wiki" && !path.startsWith(HUMAN_WIKI_PREFIX);
}

export function workflowDocumentPaths(paths: Iterable<string>): string[] {
  return [...paths]
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => isWorkflowDocumentPath(path))
    .sort();
}
