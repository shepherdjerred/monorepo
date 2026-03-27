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
      tags: { type: "string" },
    },
    allowPositionals: true,
  });

  const url = args.find((a) => !a.startsWith("-")) ?? urlOrFlag;

  if (values.crawl) {
    const result = await crawlSite({
      baseUrl: url,
      maxDepth: Number.parseInt(values.depth ?? "2", 10),
      useBrowser: values.browser ?? false,
      useSitemap: values.sitemap ?? false,
      verbose: values.verbose ?? false,
      tags: values.tags?.split(",") ?? [],
    });

    console.log(`Crawl complete:`);
    console.log(`  Fetched: ${String(result.fetched)} pages`);
    if (result.errors > 0) {
      console.log(`  Errors:  ${String(result.errors)}`);
    }
    console.log(`  Duration: ${Math.round(result.durationMs)}ms`);
    for (const p of result.savedPaths) {
      console.log(`  ${p}`);
    }
    return;
  }

  await fetchPage({
    url,
    useBrowser: values.browser ?? false,
    verbose: values.verbose ?? false,
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
  --crawl            Follow same-domain links (not yet implemented)
  --depth <N>        Crawl depth limit (default: 2)
  --sitemap          Crawl from sitemap.xml instead of link-following
  --tags <t1,t2>     Tags to attach to the saved document
  --verbose, -v      Show detailed output

Examples:
  toolkit fetch https://docs.lancedb.com/
  toolkit fetch https://react.dev/reference/react/useState --browser
  toolkit fetch https://docs.example.com/ --crawl --depth 1
`);
}
