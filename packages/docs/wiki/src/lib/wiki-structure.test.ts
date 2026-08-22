import { readdir, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, expect, test } from "vitest";

const DOCS_ROOT = new URL("../content/docs/", import.meta.url).pathname;

/** The four Diátaxis kinds. Every page belongs to exactly one. */
const SECTIONS = ["tutorials", "how-to", "reference", "explanation"];

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(full);
      }
      return entry.name.endsWith(".md") || entry.name.endsWith(".mdx")
        ? [full]
        : [];
    }),
  );
  return nested.flat();
}

function routeForFile(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.mdx?$/u, "");
  return withoutExtension === "index" ? "/" : `/${withoutExtension}/`;
}

const files = await markdownFiles(DOCS_ROOT);
const relativePaths = files.map((file) => nodePath.relative(DOCS_ROOT, file));
const routes = new Set(relativePaths.map((page) => routeForFile(page)));

describe("wiki structure", () => {
  test("finds pages", () => {
    expect(relativePaths.length).toBeGreaterThan(10);
  });

  test("every page is the home page or lives in a Diátaxis section", () => {
    const misplaced = relativePaths.filter((page) => {
      if (page === "index.md" || page === "index.mdx") {
        return false;
      }
      return !SECTIONS.some((section) => page.startsWith(`${section}/`));
    });

    expect(misplaced).toEqual([]);
  });

  test("every section that exists contains at least one page", async () => {
    const entries = await readdir(DOCS_ROOT, { withFileTypes: true });
    const presentSections = entries
      .filter((entry) => entry.isDirectory() && SECTIONS.includes(entry.name))
      .map((entry) => entry.name);

    for (const section of presentSections) {
      const sectionPages = relativePaths.filter((page) =>
        page.startsWith(`${section}/`),
      );
      expect(sectionPages.length).toBeGreaterThan(0);
    }
  });
});

describe("wiki links", () => {
  test("every internal link resolves to a real page", async () => {
    const broken: string[] = [];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      const source = nodePath.relative(DOCS_ROOT, file);

      for (const match of text.matchAll(/\]\((\/[^)\s#]*)\)/gu)) {
        const target = match[1];
        if (target === undefined) {
          continue;
        }
        if (target === "/") {
          continue;
        }
        const normalized = target.endsWith("/") ? target : `${target}/`;
        if (!routes.has(normalized)) {
          broken.push(`${source} → ${target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});
