import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { Enclosure } from "@shepherdjerred/feeds/shared/contract.ts";
import {
  discoverFeedUrlFromHtml as discoverFeedUrlInHtml,
  resolveHttpUrl,
  sanitizeEntryHtml,
  stripHtmlToPlainText,
} from "./html.ts";
import type { ParsedFeedDocument, ParsedFeedEntry } from "./types.ts";

export function discoverFeedUrlFromHtml(
  html: string,
  pageUrl: string,
): string | undefined {
  return discoverFeedUrlInHtml(html, pageUrl);
}

const XmlRecordSchema = z.record(z.string(), z.unknown());
type XmlRecord = z.infer<typeof XmlRecordSchema>;

const FUTURE_SKEW_LIMIT_SECONDS = 86_400;
const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  cdataPropName: false,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 1_000_000,
    maxExpandedLength: 25_000_000,
  },
});

function asRecord(value: unknown): XmlRecord | undefined {
  const parsed = XmlRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function toArray(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function firstElement(value: unknown): unknown {
  return Array.isArray(value) ? (value[0] as unknown) : value;
}

function firstDefined(record: XmlRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    const val = record[key];
    if (val !== undefined && val !== null) {
      return val;
    }
  }
  return undefined;
}

function extractRawString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractRawString(item);
      if (text.length > 0) {
        return text;
      }
    }
    return "";
  }
  const rec = asRecord(value);
  if (rec === undefined) {
    return "";
  }
  const directText = rec["#text"];
  return typeof directText === "string" || typeof directText === "number"
    ? String(directText).trim()
    : serializeInlineXmlRecord(rec);
}

function serializeInlineXmlRecord(rec: XmlRecord): string {
  const parts: string[] = [];
  for (const [key, child] of Object.entries(rec)) {
    if (key === "#text" || key.startsWith("@_")) {
      continue;
    }
    for (const item of toArray(child)) {
      parts.push(`<${key}>${extractRawString(item)}</${key}>`);
    }
  }
  return parts.join("");
}

function classifyLinkCandidate(candidate: unknown): {
  readonly kind: "direct" | "alternate" | "untyped" | "other" | "skip";
  readonly href: string;
} {
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return { kind: "direct", href: candidate.trim() };
  }
  const rec = asRecord(candidate);
  if (rec === undefined) {
    return { kind: "skip", href: "" };
  }
  const href = extractRawString(rec["@_href"]);
  if (href.length === 0) {
    const textHref = extractRawString(rec["#text"]);
    return textHref.length > 0
      ? { kind: "direct", href: textHref }
      : { kind: "skip", href: "" };
  }
  const rel = extractRawString(rec["@_rel"]).toLowerCase();
  if (rel === "alternate") {
    return { kind: "alternate", href };
  }
  if (rel.length === 0) {
    return { kind: "untyped", href };
  }
  return rel === "enclosure" || rel === "self" || rel === "hub"
    ? { kind: "skip", href: "" }
    : { kind: "other", href };
}

function selectAtomLinkHref(
  linksValue: unknown,
  allowFirstFallback: boolean,
): string | undefined {
  let untypedHref: string | undefined;
  let firstHref: string | undefined;
  for (const candidate of toArray(linksValue)) {
    const classified = classifyLinkCandidate(candidate);
    if (classified.kind === "direct" || classified.kind === "alternate") {
      return classified.href;
    }
    if (untypedHref === undefined && classified.kind === "untyped") {
      untypedHref = classified.href;
    } else if (firstHref === undefined && classified.kind === "other") {
      firstHref = classified.href;
    }
  }
  return untypedHref ?? (allowFirstFallback ? firstHref : undefined);
}

function extractAuthors(entry: XmlRecord): string {
  const rawAuthors = toArray(
    firstDefined(entry, ["dc:creator", "creator", "author", "atom:author"]),
  );
  const names: string[] = [];
  for (const raw of rawAuthors) {
    const rec = asRecord(raw);
    const candidate =
      rec === undefined
        ? extractRawString(raw)
        : extractRawString(
            firstDefined(rec, ["name", "atom:name", "email", "#text"]),
          );
    const clean = stripHtmlToPlainText(candidate);
    if (clean.length > 0) {
      names.push(clean);
    }
  }
  return names.join(", ");
}

function parsePublishedTimestamp(
  publishedRaw: string,
  fallbackNow: number,
): number {
  if (publishedRaw.length === 0) {
    return fallbackNow;
  }
  const ms = Date.parse(publishedRaw);
  if (Number.isNaN(ms)) {
    return fallbackNow;
  }
  const seconds = Math.floor(ms / 1000);
  return seconds <= 0 || seconds > fallbackNow + FUTURE_SKEW_LIMIT_SECONDS
    ? fallbackNow
    : seconds;
}

function parseEnclosureRecord(
  rec: XmlRecord,
  hrefKey: "@_url" | "@_href",
  baseUrl: string,
): Enclosure | undefined {
  const href = resolveHttpUrl(
    extractRawString(firstDefined(rec, [hrefKey, "@_url", "@_href"])),
    baseUrl,
  );
  if (href === null) {
    return undefined;
  }
  const mime = extractRawString(rec["@_type"]);
  const rawLen = extractRawString(rec["@_length"]);
  const parsedLen = /^\d+$/u.test(rawLen) ? Number(rawLen) : Number.NaN;
  const length =
    Number.isSafeInteger(parsedLen) && parsedLen >= 0 ? parsedLen : undefined;
  return {
    href,
    ...(mime.length > 0 ? { type: mime } : {}),
    ...(length === undefined ? {} : { length }),
  };
}

function extractEnclosures(
  entry: XmlRecord,
  baseUrl: string,
): readonly Enclosure[] {
  const results: Enclosure[] = [];
  for (const enc of toArray(entry["enclosure"])) {
    const rec = asRecord(enc);
    const parsed =
      rec === undefined
        ? undefined
        : parseEnclosureRecord(rec, "@_url", baseUrl);
    if (parsed !== undefined) {
      results.push(parsed);
    }
  }
  for (const linkNode of toArray(firstDefined(entry, ["link", "atom:link"]))) {
    const rec = asRecord(linkNode);
    if (
      rec === undefined ||
      extractRawString(rec["@_rel"]).toLowerCase() !== "enclosure"
    ) {
      continue;
    }
    const parsed = parseEnclosureRecord(rec, "@_href", baseUrl);
    if (parsed !== undefined) {
      results.push(parsed);
    }
  }
  return results;
}

function extractItemExplicitUrl(
  entry: XmlRecord,
  baseUrl: string,
): string | null {
  const linkHref = selectAtomLinkHref(
    firstDefined(entry, ["link", "atom:link"]),
    true,
  );
  const resolvedLink = resolveHttpUrl(linkHref, baseUrl);
  if (resolvedLink !== null) {
    return resolvedLink;
  }
  const rdfAbout = resolveHttpUrl(
    extractRawString(entry["@_rdf:about"]),
    baseUrl,
  );
  if (rdfAbout !== null) {
    return rdfAbout;
  }
  const guidNode = entry["guid"];
  const guidRec = asRecord(guidNode);
  const isPermaLink =
    guidRec === undefined
      ? "true"
      : extractRawString(guidRec["@_isPermaLink"]).toLowerCase();
  return isPermaLink === "false"
    ? null
    : resolveHttpUrl(extractRawString(guidNode), baseUrl);
}

function extractItemCategories(entry: XmlRecord): readonly string[] {
  const rawNodes = [
    ...toArray(entry["category"]),
    ...toArray(entry["atom:category"]),
    ...toArray(entry["dc:subject"]),
  ];
  const seen = new Set<string>();
  const addClean = (candidate: string): void => {
    const clean = stripHtmlToPlainText(candidate).trim();
    if (clean.length > 0) {
      seen.add(clean);
    }
  };
  for (const raw of rawNodes) {
    const rec = asRecord(raw);
    if (rec === undefined) {
      addClean(extractRawString(raw));
      continue;
    }
    addClean(extractRawString(rec["#text"]));
    addClean(extractRawString(rec["@_term"]));
    addClean(extractRawString(rec["@_label"]));
  }
  return [...seen];
}

function parseEntryRecord(
  entry: XmlRecord,
  baseUrl: string,
  fallbackUrl: string,
  fallbackNow: number,
): ParsedFeedEntry {
  const plainTitle = stripHtmlToPlainText(
    extractRawString(firstDefined(entry, ["title", "atom:title"])),
  );
  const title = plainTitle.length > 0 ? plainTitle : "(Untitled)";
  const publishedRaw = extractRawString(
    firstDefined(entry, [
      "pubDate",
      "published",
      "atom:published",
      "updated",
      "atom:updated",
      "dc:date",
    ]),
  );
  const explicitUrl = extractItemExplicitUrl(entry, baseUrl);
  const rawGuid = extractRawString(
    firstDefined(entry, ["guid", "id", "atom:id"]),
  );
  const guid =
    rawGuid.length > 0
      ? rawGuid
      : (explicitUrl ??
        `sha256:${createHash("sha256").update(`${title}:${publishedRaw}`).digest("hex")}`);
  const rawContent = extractRawString(
    firstDefined(entry, [
      "content:encoded",
      "content",
      "atom:content",
      "summary",
      "atom:summary",
      "description",
      "dc:description",
    ]),
  );
  return {
    guid,
    url: explicitUrl ?? fallbackUrl,
    title,
    author: extractAuthors(entry),
    contentHtml: sanitizeEntryHtml(rawContent, baseUrl),
    publishedAt: parsePublishedTimestamp(publishedRaw, fallbackNow),
    enclosures: extractEnclosures(entry, baseUrl),
    categories: extractItemCategories(entry),
  };
}

type FeedExtraction = {
  readonly metadataNode: XmlRecord;
  readonly rawEntries: readonly unknown[];
  readonly descriptionKeys: readonly string[];
};

function locateFeedRoot(doc: XmlRecord): FeedExtraction {
  const rss = asRecord(doc["rss"]);
  if (rss !== undefined) {
    const channel = asRecord(firstElement(rss["channel"]));
    if (channel === undefined) {
      throw new Error("Invalid RSS feed: missing <channel>");
    }
    return {
      metadataNode: channel,
      rawEntries: toArray(channel["item"]),
      descriptionKeys: ["description", "itunes:summary", "dc:description"],
    };
  }
  const atom = asRecord(firstDefined(doc, ["feed", "atom:feed"]));
  if (atom !== undefined) {
    return {
      metadataNode: atom,
      rawEntries: toArray(firstDefined(atom, ["entry", "atom:entry"])),
      descriptionKeys: ["subtitle", "atom:subtitle", "tagline"],
    };
  }
  const rdf = asRecord(firstDefined(doc, ["rdf:RDF", "RDF"]));
  if (rdf !== undefined) {
    const channel =
      asRecord(firstElement(firstDefined(rdf, ["channel", "rss:channel"]))) ??
      rdf;
    return {
      metadataNode: channel,
      rawEntries: toArray(
        firstDefined(rdf, ["item", "rss:item"]) ?? channel["item"],
      ),
      descriptionKeys: ["description", "dc:description"],
    };
  }
  throw new Error("Document is not a recognized RSS, Atom, or RDF feed");
}

function defaultTitleFromUrl(feedUrl: string): string {
  try {
    const parsed = new URL(feedUrl);
    return parsed.hostname.length > 0 ? parsed.hostname : "Untitled Feed";
  } catch {
    return "Untitled Feed";
  }
}

export function parseFeedXml(
  xml: string,
  feedUrl: string,
  fallbackNowSeconds?: number,
): ParsedFeedDocument {
  const cleaned = xml.replace(/^\u{FEFF}/u, "").trim();
  if (cleaned.length === 0) {
    throw new Error("Feed XML body is empty");
  }
  const doc = asRecord(XML_PARSER.parse(cleaned));
  if (doc === undefined) {
    throw new Error("Failed to parse XML document");
  }
  const { metadataNode, rawEntries, descriptionKeys } = locateFeedRoot(doc);
  const fallbackNow = fallbackNowSeconds ?? Math.floor(Date.now() / 1000);

  const cleanTitle = stripHtmlToPlainText(
    extractRawString(firstDefined(metadataNode, ["title", "atom:title"])),
  );
  const title =
    cleanTitle.length > 0 ? cleanTitle : defaultTitleFromUrl(feedUrl);
  const htmlUrl = resolveHttpUrl(
    selectAtomLinkHref(
      firstDefined(metadataNode, ["link", "atom:link"]),
      false,
    ),
    feedUrl,
  );
  const cleanDesc = stripHtmlToPlainText(
    extractRawString(firstDefined(metadataNode, descriptionKeys)),
  );
  const description = cleanDesc.length > 0 ? cleanDesc : null;

  const baseUrl = htmlUrl ?? feedUrl;
  const fallbackItemUrl = resolveHttpUrl(baseUrl, feedUrl) ?? feedUrl;
  const entries = rawEntries.flatMap((raw) => {
    const rec = asRecord(raw);
    return rec === undefined
      ? []
      : [parseEntryRecord(rec, baseUrl, fallbackItemUrl, fallbackNow)];
  });
  return { title, htmlUrl, description, entries };
}
