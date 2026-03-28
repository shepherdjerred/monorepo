import { parseArgs } from "node:util";
import { fetchPage } from "#commands/fetch/fetch.ts";
import { crawlSite } from "#lib/fetch/crawler.ts";

export async function handleFetchCommand(
  urlOrFlag: string | undefined,
  args: string[],
): Promise<void> {
  if (urlOrFlag == null || urlOrFlag === "--help" || urlOrFlag === "-h") {
    printFetchUsage();
    process.exit(0);
  }

  const { values } = parseArgs({
    args,
    options: {
      browser: { type: "boolean", default: false },
      crawl: { type: "boolean", default: false },
      depth: { type: "string", default: "2" },
      sitemap: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      json: { type: "boolean", default: false },
      tags: { type: "string" },
    },
    allowPositionals: true,
  });

  const url = args.find((a) => !a.startsWith("-")) ?? urlOrFlag;

  // N5: validate URL scheme
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      console.error(
        `Unsupported URL scheme: ${parsed.protocol}. Only http and https are supported.`,
      );
      process.exit(1);
    }
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  const depth = Number.parseInt(values.depth, 10);
  if (Number.isNaN(depth) || depth < 0) {
    console.error("Invalid --depth value. Must be a non-negative integer.");
    process.exit(1);
  }

  if (values.crawl) {
    const result = await crawlSite({
      baseUrl: url,
      maxDepth: depth,
      useBrowser: values.browser,
      useSitemap: values.sitemap,
      verbose: values.verbose,
      quiet: values.json,
      tags: values.tags?.split(",") ?? [],
    });

    if (values.json) {
      console.log(
        JSON.stringify(
          {
            fetched: result.fetched,
            errors: result.errors,
            durationMs: Math.round(result.durationMs),
            savedPaths: result.savedPaths,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`Crawl complete:`);
      console.log(`  Fetched: ${String(result.fetched)} pages`);
      if (result.errors > 0) {
        console.log(`  Errors:  ${String(result.errors)}`);
      }
      console.log(`  Duration: ${String(Math.round(result.durationMs))}ms`);
      for (const p of result.savedPaths) {
        console.log(`  ${p}`);
      }
    }
    return;
  }

  await fetchPage({
    url,
    useBrowser: values.browser,
    verbose: values.verbose,
    tags: values.tags?.split(",") ?? [],
  });
}

function printFetchUsage(): void {
  console.log(`
toolkit fetch - Fetch web pages and save to ~/.recall/fetched/

Usage:
  toolkit fetch <url> [options]

Options:
  --browser          Use PinchTab (real Chrome) instead of lightpanda
  --crawl            Follow same-domain links
  --depth <N>        Crawl depth limit (default: 2)
  --sitemap          Crawl from sitemap.xml instead of link-following
  --tags <t1,t2>     Tags to attach to the saved document
  --json             Output as JSON
  --verbose, -v      Show detailed output

Examples:
  toolkit fetch https://docs.lancedb.com/
  toolkit fetch https://react.dev/reference/react/useState --browser
  toolkit fetch https://docs.example.com/ --crawl --depth 1
`);
}
