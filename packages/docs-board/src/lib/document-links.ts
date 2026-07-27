import nodePath from "node:path";

import { rewriteMarkdownLinks } from "#shared/markdown";

export function rewriteDocumentLinks(
  body: string,
  currentPath: string,
  nextPath: string,
  movedPaths: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownLinks(body, (url) => {
    const match = /^([^?#]+)([?#].*)?$/u.exec(url);
    const linkPath = match?.[1];
    if (
      linkPath === undefined ||
      linkPath.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(linkPath) ||
      !linkPath.endsWith(".md")
    ) {
      return;
    }
    const resolved = nodePath.posix.normalize(
      nodePath.posix.join(nodePath.posix.dirname(currentPath), linkPath),
    );
    if (resolved.startsWith("../")) return;
    const movedTarget = movedPaths.get(resolved);
    if (currentPath === nextPath && movedTarget === undefined) return;
    const target = movedTarget ?? resolved;
    const relative = nodePath.posix.relative(
      nodePath.posix.dirname(nextPath),
      target,
    );
    return `${relative}${match?.[2] ?? ""}`;
  });
}
