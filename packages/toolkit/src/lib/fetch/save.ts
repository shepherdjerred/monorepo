import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RECALL_DIR = path.join(
  Bun.env["HOME"] ?? "~",
  ".recall",
  "fetched",
);

export type SaveOptions = {
  url: string;
  content: string;
  tags: string[];
  title?: string;
};

export type SaveResult = {
  filePath: string;
  domain: string;
  slug: string;
};

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

export function urlToSlug(url: string): string {
  try {
    const parsed = new URL(url);
    let slug = parsed.pathname
      .replace(/^\//, "")
      .replace(/\/$/, "")
      .replaceAll("/", "-")
      .replaceAll(/[^\w-]/g, "-")
      .replaceAll(/-+/g, "-")
      .toLowerCase();

    if (slug === "" || slug === "-") {
      slug = "index";
    }

    return slug;
  } catch {
    return "page";
  }
}

export function extractTitle(content: string, url: string): string {
  // Try to find a heading in the content
  const headingMatch = /^#[ \t]+(.+)$/m.exec(content);
  if (headingMatch?.[1] != null) {
    return headingMatch[1].trim();
  }

  // Fall back to the first non-empty line
  const firstLine = content
    .split("\n")
    .find((line) => line.trim().length > 0);
  if (firstLine != null && firstLine.trim().length > 0 && firstLine.trim().length < 200) {
    return firstLine.trim();
  }

  // Fall back to URL slug
  return urlToSlug(url);
}

export function buildFrontmatter(options: SaveOptions): string {
  const title = options.title ?? extractTitle(options.content, options.url);
  const domain = extractDomain(options.url);
  const now = new Date().toISOString();
  const tags = ["fetched", ...options.tags];

  const lines = [
    "---",
    `url: ${options.url}`,
    `title: "${title.replaceAll("\\", "").replaceAll('"', String.raw`\"`)}"`,
    `domain: ${domain}`,
    `fetched_at: ${now}`,
    `tags: [${tags.join(", ")}]`,
    "---",
    "",
  ];

  return lines.join("\n");
}

export async function saveFetchedPage(
  options: SaveOptions,
): Promise<SaveResult> {
  const domain = extractDomain(options.url);
  const slug = urlToSlug(options.url);
  const dirPath = path.join(RECALL_DIR, domain);
  const filePath = path.join(dirPath, `${slug}.md`);

  await mkdir(dirPath, { recursive: true });

  const frontmatter = buildFrontmatter(options);
  const fullContent = frontmatter + options.content;

  await writeFile(filePath, fullContent, "utf8");

  return { filePath, domain, slug };
}
