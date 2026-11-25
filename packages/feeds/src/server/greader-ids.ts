import { createHmac, timingSafeEqual } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type {
  FeedsRepository,
  ReaderStreamQuery,
  StoredEntry,
  StoredFeed,
} from "./types.ts";

const LONG_ITEM_ID_PREFIX = "tag:google.com,2005:reader/item/";
const HEX_1_TO_16 = /^[0-9a-f]{1,16}$/iu;
const POSITIVE_DECIMAL = /^[1-9]\d*$/u;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const WRITE_TOKEN_TTL_SECONDS = 30 * 60;

export const STATE_READ_PATTERN = /^user\/[^/]+\/state\/com\.google\/read$/u;
export const STATE_STARRED_PATTERN =
  /^user\/[^/]+\/state\/com\.google\/starred$/u;
export const STATE_READING_LIST_PATTERN =
  /^user\/[^/]+\/state\/com\.google\/reading-list$/u;
export const STATE_KEPT_UNREAD_PATTERN =
  /^user\/[^/]+\/state\/com\.google\/kept-unread$/u;
const USER_LABEL_PATTERN = /^user\/[^/]+\/label\/(.+)$/u;

const XmlRecordSchema = z.record(z.string(), z.unknown());
const OPML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export function toLongItemId(id: number): string {
  const hex = BigInt.asUintN(64, BigInt(id)).toString(16).padStart(16, "0");
  return `${LONG_ITEM_ID_PREFIX}${hex}`;
}

export function parseReaderItemId(raw: string): number | undefined {
  if (raw.startsWith(LONG_ITEM_ID_PREFIX)) {
    const hex = raw.slice(LONG_ITEM_ID_PREFIX.length);
    if (!HEX_1_TO_16.test(hex)) {
      return undefined;
    }
    const signed = BigInt.asIntN(64, BigInt(`0x${hex}`));
    return signed <= 0n || signed > MAX_SAFE_BIGINT
      ? undefined
      : Number(signed);
  }

  if (POSITIVE_DECIMAL.test(raw)) {
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

export function issueWriteToken(
  username: string,
  nowSec: number,
  secret: string,
): string {
  const exp = nowSec + WRITE_TOKEN_TTL_SECONDS;
  const mac = createHmac("sha256", secret)
    .update(`${username}:${String(exp)}`)
    .digest("hex");
  return `${String(exp)}.${mac}`;
}

export function verifyWriteToken(options: {
  readonly token: string | undefined;
  readonly username: string;
  readonly nowSec: number;
  readonly secret: string;
}): boolean {
  const { token, username, nowSec, secret } = options;
  if (token === undefined || secret.length === 0) {
    return false;
  }
  const parts = token.split(".");
  const expStr = parts[0];
  const macHex = parts[1];
  if (
    expStr === undefined ||
    macHex === undefined ||
    parts.length !== 2 ||
    !POSITIVE_DECIMAL.test(expStr) ||
    !HEX_64_PATTERN.test(macHex)
  ) {
    return false;
  }
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || nowSec >= exp) {
    return false;
  }
  const expectedHex = createHmac("sha256", secret)
    .update(`${username}:${expStr}`)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(macHex, "hex"),
    Buffer.from(expectedHex, "hex"),
  );
}

export function parseItemIds(rawValues: readonly string[]): readonly number[] {
  return rawValues.flatMap((raw) => {
    const parsed = parseReaderItemId(raw);
    return parsed === undefined ? [] : [parsed];
  });
}

export function extractLabel(raw: string | undefined): string | undefined {
  const match = raw === undefined ? null : USER_LABEL_PATTERN.exec(raw.trim());
  const label = match?.[1]?.trim();
  return label !== undefined && label.length > 0 ? label : undefined;
}

export function extractLabels(rawValues: readonly string[]): readonly string[] {
  return rawValues.flatMap((raw) => {
    const label = extractLabel(raw);
    return label === undefined ? [] : [label];
  });
}

export function resolveFeedFromStream(
  store: FeedsRepository,
  streamId: string | undefined,
): StoredFeed | undefined {
  if (streamId?.startsWith("feed/") !== true) {
    return undefined;
  }
  const rest = streamId.slice("feed/".length).trim();
  if (POSITIVE_DECIMAL.test(rest)) {
    return store.getFeedById(Number(rest));
  }
  return rest.length > 0 ? store.getFeedByUrl(rest) : undefined;
}

export function parseStreamTarget(
  rawStream: string | undefined,
  store: FeedsRepository,
): ReaderStreamQuery["stream"] | "empty-feed" | undefined {
  if (rawStream === undefined || STATE_READING_LIST_PATTERN.test(rawStream)) {
    return { kind: "reading-list" };
  }
  if (STATE_STARRED_PATTERN.test(rawStream)) {
    return { kind: "starred" };
  }
  const label = extractLabel(rawStream);
  if (label !== undefined) {
    return { kind: "category", label };
  }
  if (rawStream.startsWith("feed/")) {
    const resolved = resolveFeedFromStream(store, rawStream);
    return resolved === undefined
      ? "empty-feed"
      : { kind: "feed", feedId: resolved.id };
  }
  return undefined;
}

export function formatEntryItem(entry: StoredEntry) {
  return {
    id: toLongItemId(entry.id),
    crawlTimeMsec: String(entry.crawledAtMs),
    timestampUsec: String(entry.id),
    published: entry.publishedAt,
    title: entry.title,
    author: entry.author,
    summary: { content: entry.contentHtml },
    alternate: [{ href: entry.url, type: "text/html" }],
    ...(entry.enclosures.length > 0 ? { enclosure: entry.enclosures } : {}),
    categories: [
      "user/-/state/com.google/reading-list",
      `user/-/label/${entry.categoryLabel}`,
      ...(entry.isRead ? ["user/-/state/com.google/read"] : []),
      ...(entry.isStarred ? ["user/-/state/com.google/starred"] : []),
    ],
    origin: {
      streamId: `feed/${String(entry.feedId)}`,
      title: entry.feedTitle,
      ...(entry.feedHtmlUrl === null ? {} : { htmlUrl: entry.feedHtmlUrl }),
    },
  };
}

const escapeXmlAttr = (val: string): string =>
  val
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

function hasSensitiveUrlParts(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.search.length > 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    );
  } catch {
    return rawUrl.includes("?") || rawUrl.includes("@");
  }
}

export function buildOpmlXml(feeds: readonly StoredFeed[]): string {
  const byCategory = new Map<string, StoredFeed[]>();
  for (const feed of feeds) {
    if (feed.source === "user" && hasSensitiveUrlParts(feed.url)) {
      continue;
    }
    const list = byCategory.get(feed.categoryLabel) ?? [];
    list.push(feed);
    byCategory.set(feed.categoryLabel, list);
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head><title>Feeds Subscriptions</title></head>",
    "  <body>",
  ];
  for (const [category, catFeeds] of byCategory) {
    const catAttr = escapeXmlAttr(category);
    lines.push(`    <outline text="${catAttr}" title="${catAttr}">`);
    for (const feed of catFeeds) {
      const titleAttr = escapeXmlAttr(feed.title);
      const xmlAttr = escapeXmlAttr(feed.url);
      const htmlAttr =
        feed.htmlUrl === null
          ? ""
          : ` htmlUrl="${escapeXmlAttr(feed.htmlUrl)}"`;
      lines.push(
        `      <outline type="rss" text="${titleAttr}" title="${titleAttr}" xmlUrl="${xmlAttr}"${htmlAttr} />`,
      );
    }
    lines.push("    </outline>");
  }
  lines.push("  </body>", "</opml>", "");
  return lines.join("\n");
}

type OpmlOutlineItem = {
  readonly xmlUrl: string;
  readonly title?: string | undefined;
  readonly htmlUrl?: string | undefined;
  readonly category: string;
};

function readOutlineAttr(rec: Record<string, unknown>, key: string): string {
  const val = rec[key];
  return typeof val === "string" ? val.trim() : "";
}

function toOutlineArray(node: unknown): readonly unknown[] {
  if (node === undefined || node === null) {
    return [];
  }
  return Array.isArray(node) ? node : [node];
}

function collectSingleOutline(
  rec: Record<string, unknown>,
  currentCategory: string,
  acc: OpmlOutlineItem[],
): void {
  const xmlUrl = readOutlineAttr(rec, "@_xmlUrl");
  const primaryTitle = readOutlineAttr(rec, "@_title");
  const rawTitle =
    primaryTitle.length > 0 ? primaryTitle : readOutlineAttr(rec, "@_text");
  const htmlUrl = readOutlineAttr(rec, "@_htmlUrl");
  if (xmlUrl.length > 0) {
    acc.push({
      xmlUrl,
      ...(rawTitle.length > 0 ? { title: rawTitle } : {}),
      ...(htmlUrl.length > 0 ? { htmlUrl } : {}),
      category: currentCategory,
    });
  } else if (rec["outline"] !== undefined) {
    collectOpmlOutlines(
      rec["outline"],
      rawTitle.length > 0 ? rawTitle : currentCategory,
      acc,
    );
  }
}

function collectOpmlOutlines(
  node: unknown,
  currentCategory: string,
  acc: OpmlOutlineItem[],
): void {
  for (const item of toOutlineArray(node)) {
    const parsed = XmlRecordSchema.safeParse(item);
    if (parsed.success) {
      collectSingleOutline(parsed.data, currentCategory, acc);
    }
  }
}

function isHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function importOpmlXml(
  store: FeedsRepository,
  xmlText: string,
): boolean {
  const parsedDoc = XmlRecordSchema.safeParse(OPML_PARSER.parse(xmlText));
  const opmlRec = parsedDoc.success
    ? XmlRecordSchema.safeParse(parsedDoc.data["opml"])
    : undefined;
  const bodyRec =
    opmlRec?.success === true
      ? XmlRecordSchema.safeParse(opmlRec.data["body"])
      : undefined;
  if (bodyRec?.success !== true) {
    return false;
  }
  const outlines: OpmlOutlineItem[] = [];
  collectOpmlOutlines(bodyRec.data["outline"], "Uncategorized", outlines);
  for (const item of outlines) {
    if (isHttpUrl(item.xmlUrl)) {
      store.createUserFeed({
        url: item.xmlUrl,
        ...(item.title === undefined ? {} : { title: item.title }),
        category: item.category,
        ...(item.htmlUrl === undefined ? {} : { htmlUrl: item.htmlUrl }),
        hidden: false,
      });
    }
  }
  return true;
}
