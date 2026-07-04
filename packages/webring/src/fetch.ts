import Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";
import { Parser as HtmlParser } from "htmlparser2";
import {
  type Source,
  type ResultEntry,
  FeedEntrySchema,
  type Configuration,
} from "./types.ts";
import * as R from "remeda";
import { asyncMapFilterUndefined } from "./util.ts";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

function escapeText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttributeValue(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

/**
 * Truncate HTML to `length` text characters while keeping tags balanced.
 * Whitespace runs collapse to a single space and `...` marks a cut, matching
 * the behavior of the retired `truncate-html` package (which was pinned to a
 * dead cheerio 1.0.0-rc.12/htmlparser2@6 chain).
 */
function truncate(html: string, length = 300): string {
  let out = "";
  let remaining = length;
  let truncated = false;
  const openTags: string[] = [];

  const parser = new HtmlParser({
    onopentag(name, attributes) {
      if (truncated) {
        return;
      }
      const attributeText = Object.entries(attributes)
        .map(([key, value]) =>
          value === "" ? ` ${key}` : ` ${key}="${escapeAttributeValue(value)}"`,
        )
        .join("");
      out += `<${name}${attributeText}>`;
      if (!VOID_TAGS.has(name)) {
        openTags.push(name);
      }
    },
    ontext(text) {
      if (truncated) {
        return;
      }
      const collapsed = text.replaceAll(/\s+/g, " ");
      if (collapsed.length <= remaining) {
        out += escapeText(collapsed);
        remaining -= collapsed.length;
        return;
      }
      out += `${escapeText(collapsed.slice(0, remaining))}...`;
      truncated = true;
    },
    onclosetag(name) {
      if (VOID_TAGS.has(name)) {
        return;
      }
      // Only emit closes for tags we actually opened (tags opened after the
      // cut never enter the stack, so their close events are dropped too).
      const index = openTags.lastIndexOf(name);
      if (index === -1) {
        return;
      }
      openTags.splice(index, 1);
      out += `</${name}>`;
    },
  });
  parser.write(html);
  parser.end();

  for (const name of openTags.reverse()) {
    out += `</${name}>`;
  }
  return out;
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
