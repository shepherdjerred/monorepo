import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export const FRESHRSS_MANAGED_CATEGORY = "Repo Stack";
export const FRESHRSS_PRERELEASE_FILTER = String.raw`intitle:/\b(alpha|beta|rc|canary|dev|nightly|preview|pre)\b/i`;

const FeedOutlineSchema = z
  .object({
    text: z.string().trim().min(1),
    type: z.literal("rss"),
    xmlUrl: z.url(),
    htmlUrl: z.url().optional(),
    description: z.string().optional(),
    "frss:priority": z.string().optional(),
    "frss:filtersActionRead": z.string().trim().min(1).optional(),
  })
  .strict();

const CategoryOutlineSchema = z
  .object({
    text: z.string().trim().min(1),
    outline: z.array(FeedOutlineSchema).min(1),
  })
  .strict();

const OpmlDocumentSchema = z
  .object({
    opml: z
      .object({
        version: z.literal(2),
        "xmlns:frss": z.literal("https://freshrss.org/opml"),
        head: z
          .object({
            title: z.string().trim().min(1),
            dateCreated: z.string().trim().min(1).optional(),
          })
          .strict(),
        body: z
          .object({ outline: z.array(CategoryOutlineSchema).min(1) })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const FreshRssDesiredFeedSchema = z
  .object({
    title: z.string().trim().min(1),
    url: z.url(),
    htmlUrl: z.url().optional(),
    description: z.string().optional(),
    filtersActionRead: z.string().trim().min(1).optional(),
  })
  .strict();

export const FreshRssDesiredManifestSchema = z
  .object({
    category: z.literal(FRESHRSS_MANAGED_CATEGORY),
    feeds: z.array(FreshRssDesiredFeedSchema).min(1),
  })
  .strict();

export type FreshRssDesiredManifest = z.infer<
  typeof FreshRssDesiredManifestSchema
>;

const CREDENTIAL_QUERY_PARAMETER =
  /^(?:access_?token|api_?key|auth|credential|key|passwd|password|secret|token)$/i;

function validatePublicUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (url.username !== "" || url.password !== "") {
    throw new Error(
      `Feed URL must not contain embedded credentials: ${url.origin}`,
    );
  }
  for (const parameter of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_PARAMETER.test(parameter)) {
      throw new Error(
        `Feed URL must not contain credential query parameter ${JSON.stringify(parameter)}: ${url.origin}`,
      );
    }
  }
}

export function parseFreshRssOpml(xml: string): FreshRssDesiredManifest {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: true,
    ignoreDeclaration: true,
    isArray: (name) => name === "outline",
  });
  const parsed: unknown = parser.parse(xml);
  const document = OpmlDocumentSchema.parse(parsed);
  const categories = document.opml.body.outline;
  const managedCategories = categories.filter(
    (category) => category.text === FRESHRSS_MANAGED_CATEGORY,
  );
  if (managedCategories.length !== 1) {
    throw new Error(
      `Expected exactly one ${JSON.stringify(FRESHRSS_MANAGED_CATEGORY)} category, found ${String(managedCategories.length)}`,
    );
  }

  const urls = new Set<string>();
  for (const category of categories) {
    for (const feed of category.outline) {
      validatePublicUrl(feed.xmlUrl);
      if (feed.htmlUrl !== undefined) validatePublicUrl(feed.htmlUrl);
      if (urls.has(feed.xmlUrl)) {
        throw new Error(`Duplicate feed URL: ${feed.xmlUrl}`);
      }
      urls.add(feed.xmlUrl);
    }
  }

  const managedCategory = managedCategories[0];
  if (managedCategory === undefined) {
    throw new Error("Managed FreshRSS category disappeared after validation");
  }
  return FreshRssDesiredManifestSchema.parse({
    category: managedCategory.text,
    feeds: managedCategory.outline.map((feed) => ({
      title: feed.text,
      url: feed.xmlUrl,
      htmlUrl: feed.htmlUrl,
      description: feed.description,
      filtersActionRead: feed["frss:filtersActionRead"],
    })),
  });
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildManagedFreshRssOpml(
  manifest: FreshRssDesiredManifest,
): string {
  const validated = FreshRssDesiredManifestSchema.parse(manifest);
  const outlines = validated.feeds.map((feed) => {
    const attributes = [
      `text="${escapeXmlAttribute(feed.title)}"`,
      'type="rss"',
      `xmlUrl="${escapeXmlAttribute(feed.url)}"`,
    ];
    if (feed.htmlUrl !== undefined) {
      attributes.push(`htmlUrl="${escapeXmlAttribute(feed.htmlUrl)}"`);
    }
    if (feed.description !== undefined) {
      attributes.push(`description="${escapeXmlAttribute(feed.description)}"`);
    }
    if (feed.filtersActionRead !== undefined) {
      attributes.push(
        `frss:filtersActionRead="${escapeXmlAttribute(feed.filtersActionRead)}"`,
      );
    }
    return `      <outline ${attributes.join(" ")}/>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml xmlns:frss="https://freshrss.org/opml" version="2.0">',
    "  <head>",
    "    <title>Repo Stack</title>",
    "  </head>",
    "  <body>",
    `    <outline text="${escapeXmlAttribute(validated.category)}">`,
    ...outlines,
    "    </outline>",
    "  </body>",
    "</opml>",
    "",
  ].join("\n");
}
