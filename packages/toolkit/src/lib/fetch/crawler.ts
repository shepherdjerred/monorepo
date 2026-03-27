import { fetchWithLightpanda } from "./lightpanda.ts";
import { fetchWithPinchtab } from "./pinchtab.ts";
import { saveFetchedPage, extractDomain } from "./save.ts";

const MAX_URLS = 500;
const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export type CrawlOptions = {
  baseUrl: string;
  maxDepth: number;
  useBrowser: boolean;
  useSitemap: boolean;
  verbose: boolean;
  tags: string[];
};

export type CrawlResult = {
  fetched: number;
  errors: number;
  savedPaths: string[];
  durationMs: number;
};

/**
 * Crawl a docs site starting from baseUrl.
 * Follows same-domain links up to maxDepth, or uses sitemap.xml.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const start = performance.now();
  const { baseUrl, maxDepth, useBrowser, useSitemap, verbose, tags } = options;

  const urls = await (useSitemap ? fetchSitemapUrls(baseUrl, useBrowser, verbose) : discoverUrls(baseUrl, maxDepth, useBrowser, verbose));

  if (verbose) {
    console.error(`[crawl] discovered ${String(urls.length)} URLs`);
  }

  const savedPaths: string[] = [];
  let errors = 0;

  for (const [i, url] of urls.entries()) {
    // Rate limit between fetches
    if (i > 0) await sleep(DELAY_MS);

    try {
      const result = useBrowser
        ? await fetchWithPinchtab(url, verbose)
        : await fetchWithLightpanda(url, verbose);

      if (!result.success || result.content == null || result.content.trim().length === 0) {
        errors++;
        if (verbose) console.error(`[crawl] skip (empty/error): ${url}`);
        continue;
      }

      const saved = await saveFetchedPage({
        url,
        content: result.content,
        tags,
      });

      savedPaths.push(saved.filePath);

      if (verbose) {
        console.error(`[crawl] saved: ${saved.filePath}`);
      }
    } catch (error) {
      errors++;
      if (verbose) console.error(`[crawl] error fetching ${url}: ${String(error)}`);
    }
  }

  return {
    fetched: savedPaths.length,
    errors,
    savedPaths,
    durationMs: performance.now() - start,
  };
}

/**
 * Discover URLs by following same-domain links up to maxDepth.
 */
async function discoverUrls(
  startUrl: string,
  maxDepth: number,
  useBrowser: boolean,
  verbose: boolean,
): Promise<string[]> {
  const domain = extractDomain(startUrl);
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const discovered: string[] = [];

  while (queue.length > 0) {
    const item = queue.shift();
    if (item == null) break;
    const normalized = normalizeUrl(item.url);

    if (visited.has(normalized)) continue;
    if (discovered.length >= MAX_URLS) break;
    visited.add(normalized);
    discovered.push(normalized);

    if (item.depth >= maxDepth) continue;

    // Fetch page and extract links
    const result = useBrowser
      ? await fetchWithPinchtab(item.url, false)
      : await fetchWithLightpanda(item.url, false);

    if (!result.success || result.content == null) continue;

    const links = extractLinks(result.content, item.url, domain);
    for (const link of links) {
      if (!visited.has(normalizeUrl(link))) {
        queue.push({ url: link, depth: item.depth + 1 });
      }
    }

    if (verbose) {
      console.error(
        `[crawl] depth ${String(item.depth)}: ${item.url} → ${String(links.length)} links`,
      );
    }
  }

  return discovered;
}

/**
 * Fetch sitemap.xml and extract URLs matching the base domain/path.
 */
async function fetchSitemapUrls(
  baseUrl: string,
  _useBrowser: boolean,
  verbose: boolean,
): Promise<string[]> {
  const parsed = new URL(baseUrl);
  const sitemapUrl = `${parsed.origin}/sitemap.xml`;

  if (verbose) {
    console.error(`[crawl] fetching sitemap: ${sitemapUrl}`);
  }

  // Fetch raw XML (use lightpanda with html dump since it's XML)
  const proc = Bun.spawn(
    [
      "lightpanda",
      "fetch",
      "--dump",
      "html",
      "--log_level",
      "fatal",
      sitemapUrl,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const content = await new Response(proc.stdout).text();
  await proc.exited;

  if (proc.exitCode !== 0 || content.trim().length === 0) {
    if (verbose) console.error("[crawl] sitemap.xml not found, falling back to link discovery");
    return [baseUrl];
  }

  // Parse URLs from sitemap XML
  const urls: string[] = [];
  const locRegex = /<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = locRegex.exec(content)) != null) {
    const url = match[1];
    if (url == null) continue;
    const trimmedUrl = decodeXmlEntities(url.trim());
    // Filter to same domain and base path
    if (trimmedUrl.startsWith(parsed.origin) && trimmedUrl.startsWith(baseUrl.replace(/\/$/, ""))) {
      urls.push(trimmedUrl);
    }
  }

  if (verbose) {
    console.error(`[crawl] sitemap: ${String(urls.length)} URLs matching ${baseUrl}`);
  }

  return urls.length > 0 ? urls : [baseUrl];
}

/**
 * Extract same-domain links from markdown content.
 */
function extractLinks(
  content: string,
  pageUrl: string,
  targetDomain: string,
): string[] {
  const links = new Set<string>();

  // Match markdown links: [text](url)
  const mdLinkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = mdLinkRegex.exec(content)) != null) {
    const href = match[1];
    if (href == null) continue;
    const trimmedHref = href.trim();
    const resolved = resolveUrl(trimmedHref, pageUrl);
    if (resolved != null && extractDomain(resolved) === targetDomain) {
      links.add(normalizeUrl(resolved));
    }
  }

  // Match bare URLs
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
  while ((match = urlRegex.exec(content)) != null) {
    const url = match[0];
    if (extractDomain(url) === targetDomain) {
      links.add(normalizeUrl(url));
    }
  }

  return [...links];
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove fragments and trailing slashes for dedup
    parsed.hash = "";
    let normalized = parsed.href;
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url;
  }
}
