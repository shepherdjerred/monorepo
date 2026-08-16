import nodePath from "node:path";

const URL_SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const LINE_SUFFIX = /:(\d+)(?:-(\d+))?$/u;
const REPOSITORY_URL = "https://github.com/shepherdjerred/monorepo";

export function rewriteWikiLink(sourcePath: string, url: string): string {
  if (
    url.length === 0 ||
    url.startsWith("#") ||
    url.startsWith("/") ||
    URL_SCHEME.test(url)
  ) {
    return url;
  }

  const { pathname, suffix } = splitUrlSuffix(url);
  const lineMatch = LINE_SUFFIX.exec(pathname);
  const pathWithoutLine = lineMatch
    ? pathname.slice(0, Math.max(0, pathname.length - lineMatch[0].length))
    : pathname;
  const normalizedTarget = pathWithoutLine.startsWith("packages/")
    ? nodePath.posix.normalize(pathWithoutLine)
    : nodePath.posix.normalize(
        nodePath.posix.join(
          nodePath.posix.dirname(sourcePath),
          pathWithoutLine,
        ),
      );

  return repositoryFileUrl(normalizedTarget, suffix, lineMatch, pathname);
}

function repositoryFileUrl(
  normalizedTarget: string,
  suffix: string,
  lineMatch: RegExpExecArray | null,
  pathname: string,
): string {
  let lineFragment = suffix.startsWith("#") ? suffix : "";
  if (lineMatch !== null) {
    const startLine = lineMatch[1];
    if (startLine === undefined) {
      throw new Error(`Line suffix did not include a start line: ${pathname}`);
    }
    const endLine = lineMatch[2];
    lineFragment = `#L${startLine}${endLine === undefined ? "" : `-L${endLine}`}`;
  }
  const query = suffix.startsWith("?") ? suffix : "";
  return `${REPOSITORY_URL}/blob/main/${normalizedTarget}${query}${lineFragment}`;
}

function splitUrlSuffix(url: string): { pathname: string; suffix: string } {
  const queryIndex = url.indexOf("?");
  const fragmentIndex = url.indexOf("#");
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const suffixIndex = indexes.length === 0 ? -1 : Math.min(...indexes);
  if (suffixIndex < 0) {
    return { pathname: url, suffix: "" };
  }
  return {
    pathname: url.slice(0, suffixIndex),
    suffix: url.slice(suffixIndex),
  };
}
