import { Parser as HtmlParser } from "htmlparser2";
import sanitizeHtml from "sanitize-html";

const ALLOWED_ARTICLE_TAGS = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "picture",
  "img",
  "a",
];

const FEED_MIME_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/rdf+xml",
]);
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

export function stripHtmlToPlainText(html: string): string {
  if (html.length === 0) {
    return "";
  }
  const chunks: string[] = [];
  const parser = new HtmlParser(
    { ontext: (data) => chunks.push(data) },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return chunks.join("").replaceAll(/\s+/gu, " ").trim();
}

export function resolveHttpUrl(
  rawUrl: string | undefined,
  baseUrl: string,
): string | null {
  const trimmed = rawUrl?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

function resolveAllowedHref(
  rawHref: string | undefined,
  baseUrl: string,
  allowedProtocols: ReadonlySet<string>,
): string | undefined {
  const trimmed = rawHref?.trim() ?? "";
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    return allowedProtocols.has(resolved.protocol)
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeEntryHtml(rawHtml: string, baseUrl: string): string {
  if (rawHtml.trim().length === 0) {
    return "";
  }
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_ARTICLE_TAGS,
    disallowedTagsMode: "discard",
    nonTextTags: [
      "style",
      "script",
      "textarea",
      "option",
      "noscript",
      "iframe",
      "object",
      "form",
    ],
    allowedAttributes: {
      a: ["href", "title", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto"],
      img: ["http", "https"],
    },
    allowProtocolRelative: false,
    transformTags: {
      a(_tagName, attribs) {
        const nextAttribs: Record<string, string> = {};
        const resolved = resolveAllowedHref(
          attribs["href"],
          baseUrl,
          LINK_PROTOCOLS,
        );
        if (resolved !== undefined) {
          nextAttribs["href"] = resolved;
        }
        const title = attribs["title"];
        if (title !== undefined && title.length > 0) {
          nextAttribs["title"] = title;
        }
        nextAttribs["rel"] = "noopener noreferrer";
        return { tagName: "a", attribs: nextAttribs };
      },
      img(_tagName, attribs) {
        const nextAttribs: Record<string, string> = {};
        const resolved = resolveAllowedHref(
          attribs["src"],
          baseUrl,
          IMAGE_PROTOCOLS,
        );
        if (resolved !== undefined) {
          nextAttribs["src"] = resolved;
        }
        for (const attr of ["alt", "title", "width", "height"] as const) {
          const val = attribs[attr];
          if (val !== undefined && val.length > 0) {
            nextAttribs[attr] = val;
          }
        }
        nextAttribs["loading"] = "lazy";
        return { tagName: "img", attribs: nextAttribs };
      },
    },
  });
}

export function discoverFeedUrlFromHtml(
  html: string,
  pageUrl: string,
): string | undefined {
  let discovered: string | undefined;
  const parser = new HtmlParser(
    {
      onopentag(name, attribs) {
        if (discovered !== undefined || name !== "link") {
          return;
        }
        const relTokens = (attribs["rel"] ?? "").toLowerCase().split(/\s+/u);
        if (!relTokens.includes("alternate")) {
          return;
        }
        const rawType = (attribs["type"] ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase();
        if (rawType === undefined || !FEED_MIME_TYPES.has(rawType)) {
          return;
        }
        const resolved = resolveHttpUrl(attribs["href"], pageUrl);
        if (resolved !== null) {
          discovered = resolved;
        }
      },
    },
    {
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
      decodeEntities: true,
    },
  );
  parser.write(html);
  parser.end();
  return discovered;
}
