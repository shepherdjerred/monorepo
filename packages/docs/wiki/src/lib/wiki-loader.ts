import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Loader, LoaderContext } from "astro/loaders";
import { z } from "astro/zod";
import { glob } from "tinyglobby";

import {
  markdownPathToSlug,
  workingDirectorySlug,
  workingDocumentSlug,
  type WikiSourceKind,
} from "./wiki-paths.ts";

const MARKDOWN_PATTERN = "**/*.md";
const WIKI_DIRECTORY = "wiki";
const REPOSITORY_EDIT_URL =
  "https://github.com/shepherdjerred/monorepo/edit/main/";
const RenderedMetadataSchema = z
  .object({
    frontmatter: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

type SourceEntry = {
  body: string;
  filePath: string;
  id: string;
  sourceKind: WikiSourceKind;
  sourcePath: string;
};

export function wikiDocsLoader(): Loader {
  return {
    name: "human-wiki-docs",
    async load(context) {
      await syncWiki(context);
      registerWatcher(context);
    },
  };
}

async function syncWiki(context: LoaderContext): Promise<void> {
  const wikiRoot = path.resolve(context.config.root.pathname);
  const docsRoot = path.resolve(wikiRoot, "..");
  const humanRoot = path.join(wikiRoot, "src/content/docs");
  const entries = [
    ...(await loadHumanEntries(humanRoot)),
    ...(await loadWorkingEntries(docsRoot)),
  ];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`Duplicate wiki route: ${entry.id}`);
    }
    seenIds.add(entry.id);
    await storeEntry(context, entry);
  }

  for (const id of context.store.keys()) {
    if (!seenIds.has(id)) {
      context.store.delete(id);
    }
  }

  context.logger.info(
    `Loaded ${entries.length.toString()} pages (${entries.filter(({ sourceKind }) => sourceKind === "working").length.toString()} working documents).`,
  );
}

async function loadHumanEntries(humanRoot: string): Promise<SourceEntry[]> {
  const paths = await glob(MARKDOWN_PATTERN, {
    cwd: humanRoot,
    onlyFiles: true,
  });
  return Promise.all(
    paths.sort().map(async (entryPath) => ({
      body: await readFile(path.join(humanRoot, entryPath), "utf8"),
      filePath: path.join(humanRoot, entryPath),
      id: markdownPathToSlug(entryPath),
      sourceKind: "human",
      sourcePath: `packages/docs/wiki/src/content/docs/${entryPath}`,
    })),
  );
}

async function loadWorkingEntries(docsRoot: string): Promise<SourceEntry[]> {
  const workingPaths = await glob(MARKDOWN_PATTERN, {
    cwd: docsRoot,
    ignore: [`${WIKI_DIRECTORY}/**`],
    onlyFiles: true,
  });
  const paths = workingPaths.sort();
  const documentEntries = await Promise.all(
    paths.map(async (entryPath) => ({
      body: await readFile(path.join(docsRoot, entryPath), "utf8"),
      filePath: path.join(docsRoot, entryPath),
      id: workingDocumentSlug(entryPath),
      sourceKind: "working" as const,
      sourcePath: `packages/docs/${entryPath}`,
    })),
  );
  const directoryEntries = createDirectoryEntries(paths, docsRoot);
  return [...documentEntries, ...directoryEntries];
}

function createDirectoryEntries(
  documentPaths: string[],
  docsRoot: string,
): SourceEntry[] {
  const directories = new Set<string>();
  const indexedDirectories = new Set<string>();

  for (const documentPath of documentPaths) {
    let directory = path.posix.dirname(documentPath);
    if (path.posix.basename(documentPath) === "index.md") {
      indexedDirectories.add(directory);
    }
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }

  return [...directories]
    .filter((directory) => !indexedDirectories.has(directory))
    .sort()
    .map((directory) => {
      const children = directChildren(documentPaths, directory);
      const body = [
        `# ${humanize(path.posix.basename(directory))}`,
        "",
        "AI working documents in this directory:",
        "",
        ...children.map(({ label, route }) => `- [${label}](/${route}/)`),
        "",
      ].join("\n");
      return {
        body,
        filePath: path.join(docsRoot, directory, ".wiki-directory.md"),
        id: workingDirectorySlug(directory),
        sourceKind: "working",
        sourcePath: `packages/docs/${directory}/`,
      };
    });
}

function directChildren(
  documentPaths: string[],
  directory: string,
): { label: string; route: string }[] {
  const children = new Map<string, { label: string; route: string }>();
  for (const documentPath of documentPaths) {
    const relativePath = path.posix.relative(directory, documentPath);
    if (relativePath.startsWith("../") || relativePath === "index.md") {
      continue;
    }
    const [firstSegment] = relativePath.split("/");
    if (firstSegment === undefined || firstSegment.length === 0) {
      continue;
    }
    const childPath = path.posix.join(directory, firstSegment);
    const isDirectory = relativePath.includes("/");
    const key = isDirectory ? childPath : documentPath;
    children.set(key, {
      label: humanize(firstSegment.replace(/\.md$/u, "")),
      route: isDirectory
        ? workingDirectorySlug(childPath)
        : workingDocumentSlug(documentPath),
    });
  }
  return [...children.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

async function storeEntry(
  context: LoaderContext,
  entry: SourceEntry,
): Promise<void> {
  const digest = context.generateDigest(entry.body);
  const existingEntry = context.store.get(entry.id);
  if (existingEntry?.digest === digest) {
    return;
  }

  const rendered = await context.renderMarkdown(entry.body, {
    fileURL: pathToFileURL(entry.filePath),
  });
  const rawFrontmatter = frontmatterFromMetadata(rendered.metadata);
  const title =
    entry.sourceKind === "human"
      ? rawFrontmatter.title
      : rendered.metadata?.headings?.find(({ depth }) => depth === 1)?.text;
  if (typeof title !== "string" || title.length === 0) {
    throw new Error(`${entry.sourcePath} must have a title.`);
  }

  const workingData =
    entry.sourceKind === "working"
      ? {
          banner: {
            content:
              "Working material — AI-maintained source context, not a curated explanation.",
          },
          editUrl: entry.sourcePath.endsWith("/")
            ? `https://github.com/shepherdjerred/monorepo/tree/main/${entry.sourcePath}`
            : `${REPOSITORY_EDIT_URL}${entry.sourcePath}`,
          head: [
            {
              attrs: { content: "noindex,follow", name: "robots" },
              tag: "meta",
            },
          ],
          next: false,
          pagefind: true,
          prev: false,
          sidebar: { hidden: true },
        }
      : {};
  const data = await context.parseData({
    data: {
      ...rawFrontmatter,
      ...workingData,
      sourceKind: entry.sourceKind,
      sourcePath: entry.sourcePath,
      title,
    },
    filePath: entry.filePath,
    id: entry.id,
  });

  context.store.set({
    body: entry.body,
    data,
    digest,
    filePath: path.relative(
      path.resolve(context.config.root.pathname),
      entry.filePath,
    ),
    id: entry.id,
    rendered,
  });
}

function registerWatcher(context: LoaderContext): void {
  if (!context.watcher) {
    return;
  }

  const docsRoot = path.resolve(context.config.root.pathname, "..");
  context.watcher.add(docsRoot);
  const reload = (changedPath: string): void => {
    if (
      changedPath.endsWith(".md") &&
      !changedPath.includes(`${path.join(docsRoot, WIKI_DIRECTORY, "dist")}/`)
    ) {
      void syncWiki(context);
    }
  };
  context.watcher.on("add", reload);
  context.watcher.on("change", reload);
  context.watcher.on("unlink", reload);
}

function humanize(value: string): string {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replaceAll(/\b\w/gu, (character) => character.toUpperCase());
}

function frontmatterFromMetadata(metadata: unknown): Record<string, unknown> {
  const parsed = RenderedMetadataSchema.safeParse(metadata);
  return parsed.success ? (parsed.data.frontmatter ?? {}) : {};
}
