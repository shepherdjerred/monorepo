import Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";
import * as truncateHtml from "truncate-html";
import { z } from "zod";
import {
  type Source,
  type ResultEntry,
  FeedEntrySchema,
  type Configuration,
} from "./types.ts";
import * as R from "remeda";
import { asyncMapFilterUndefined } from "./util.ts";

// Handle ESM/CommonJS interop - truncate-html exports differently in different environments
const TruncateFnSchema = z
  .function()
  .args(z.string(), z.number().optional())
  .returns(z.string());
const TruncateModuleSchema = z.object({ default: TruncateFnSchema });

function truncate(html: string, length?: number): string {
  const mod = truncateHtml as unknown;
  const fnResult = TruncateFnSchema.safeParse(mod);
  if (fnResult.success) {
    return fnResult.data(html, length);
  }
  const modResult = TruncateModuleSchema.safeParse(mod);
  if (modResult.success) {
    return modResult.data.default(html, length);
  }
  throw new Error("truncate-html module could not be resolved");
}

export async function fetchAll(config: Configuration) {
  return await asyncMapFilterUndefined(config.sources, (source) =>
    fetch(source, config.truncate),
  );
}

export async function fetch(
  source: Source,
  length: number,
): Promise<ResultEntry | undefined> {
  const parser = new Parser();

  try {
    const feed = await parser.parseURL(source.url);

    const firstItem = R.pipe(
      feed.items,
      R.map((item) => FeedEntrySchema.parse(item)),
      R.sortBy((item) => new Date(item.date).getTime()),
      R.reverse(),
      R.first(),
    );

    if (!firstItem) {
      throw new Error("no items found in feed");
    }

    const preview =
      firstItem.contentSnippet ??
      firstItem.content ??
      firstItem.description ??
      firstItem["content:encoded"];

    return {
      title: firstItem.title,
      url: firstItem.link,
      date: new Date(firstItem.date),
      source,
      preview:
        preview !== undefined && preview !== ""
          ? truncate(
              sanitizeHtml(preview, { parseStyleAttributes: false }),
              length,
            )
          : undefined,
    };
  } catch (error) {
    console.error(`Error fetching ${source.url}: ${String(error)}`);
    return undefined;
  }
}
