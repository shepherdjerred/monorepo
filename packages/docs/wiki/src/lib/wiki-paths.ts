import nodePath from "node:path";

import {
  isPublicWorkingDirectoryPath,
  isPublicWorkingDocumentPath,
} from "./wiki-publication.ts";

const MARKDOWN_EXTENSION = /\.mdx?$/u;
const MARKDOWN_EXTENSION_GLOBAL = /\.mdx?$/gu;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const LINE_SUFFIX = /:(\d+)(?:-(\d+))?$/u;
const REPOSITORY_URL = "https://github.com/shepherdjerred/monorepo";

export type WikiSourceKind = "human" | "working";

export function markdownPathToSlug(sourcePath: string): string {
  const withoutExtension = sourcePath.replaceAll(MARKDOWN_EXTENSION_GLOBAL, "");
  const withoutIndex = withoutExtension.replaceAll(/(?:^|\/)index$/gu, "");
  return withoutIndex.replaceAll(/^\/|\/$/gu, "") || "index";
}

export function workingDocumentSlug(sourcePath: string): string {
  const sourceSlug = markdownPathToSlug(sourcePath);
  return sourceSlug === "index"
    ? "working/source-index"
    : `working/${sourceSlug}`;
}

export function workingDirectorySlug(sourcePath: string): string {
  const normalized = sourcePath.replaceAll(/^\/|\/$/gu, "");
  return normalized.length === 0 ? "working" : `working/${normalized}`;
}

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

  if (normalizedTarget === "packages/docs") {
    return `/working/${suffix}`;
  }

  if (normalizedTarget.startsWith("packages/docs/")) {
    const docsPath = normalizedTarget.slice("packages/docs/".length);
    if (
      MARKDOWN_EXTENSION.test(docsPath) &&
      isPublicWorkingDocumentPath(docsPath)
    ) {
      return `/${workingDocumentSlug(docsPath)}/${suffix}`;
    }
    if (
      nodePath.posix.extname(docsPath).length === 0 &&
      isPublicWorkingDirectoryPath(docsPath)
    ) {
      return `/${workingDirectorySlug(docsPath)}/${suffix}`;
    }
    if (nodePath.posix.extname(docsPath).length === 0) {
      return repositoryDirectoryUrl(normalizedTarget, suffix);
    }
  }

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

function repositoryDirectoryUrl(
  normalizedTarget: string,
  suffix: string,
): string {
  return `${REPOSITORY_URL}/tree/main/${normalizedTarget}${suffix}`;
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
