import { fetchWithLightpanda } from "#lib/fetch/lightpanda.ts";
import { fetchWithPinchtab } from "#lib/fetch/pinchtab.ts";
import { saveFetchedPage } from "#lib/fetch/save.ts";

export type FetchPageOptions = {
  url: string;
  useBrowser: boolean;
  verbose: boolean;
  tags: string[];
};

export async function fetchPage(options: FetchPageOptions): Promise<void> {
  const { url, useBrowser, verbose, tags } = options;

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  if (verbose) {
    console.error(`[fetch] engine: ${useBrowser ? "pinchtab" : "lightpanda"}`);
  }

  // Fetch the page
  const result = useBrowser
    ? await fetchWithPinchtab(url, verbose)
    : await fetchWithLightpanda(url, verbose);

  if (!result.success || result.content == null) {
    console.error(`Failed to fetch ${url}: ${result.error ?? "unknown error"}`);
    process.exit(1);
  }

  if (result.content.trim().length === 0) {
    console.error(`Fetched empty content from ${url}`);
    process.exit(1);
  }

  // Save to well-known directory
  const saved = await saveFetchedPage({
    url,
    content: result.content,
    tags,
  });

  if (verbose) {
    console.error(`[fetch] saving: ${saved.filePath}`);
    console.error(
      `[fetch] done (${String(Math.round(result.durationMs))}ms)`,
    );
  }

  // Print the saved path to stdout (for piping/scripting)
  console.log(saved.filePath);
}
